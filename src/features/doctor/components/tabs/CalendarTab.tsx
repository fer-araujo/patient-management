import { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  User,
  Phone,
  Calendar as CalendarIcon,
  Plus,
  Settings,
  Ban,
  Edit3,
} from "lucide-react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DatePicker } from "../../../../components/ui/DatePicker";
import {
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  type DashboardAppointment,
} from "../../../../lib/services/clinicService";
import {
  deleteBlockedSlot,
  createBlockedSlot,
  updateBlockedSlot,
  type DashboardBlockedSlot,
} from "../../../../lib/services/blockedSlotsService";
import {
  updateClinicSettings,
  type WeeklySchedule,
} from "../../../../lib/services/settingsService";
import {
  fetchPayment,
  type Payment,
} from "../../../../lib/services/financeService";
import { formatMXN } from "../../../../lib/services/inventoryService";
import { ChargeModal } from "../modals/ChargeModal";
import { useCalendar } from "../../hooks/useCalendar";
import { WeeklyView } from "./calendar/WeeklyView";
import { DailyView } from "./calendar/DailyView";
import { MonthlyView } from "./calendar/MonthlyView";
import {
  combineIsoDateAndTime,
  parseVisualDateToISO,
  getAvailableTimeOptions,
} from "../../utils/calendarUtils";
import toast from "react-hot-toast";

const getISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface CalendarTabProps {
  appointments: DashboardAppointment[];
  blockedSlots: DashboardBlockedSlot[];
  onStartConsultation: (appointment: DashboardAppointment) => void;
  onDataChange: () => Promise<void>;
}

export const CalendarTab = ({
  appointments,
  blockedSlots,
  onStartConsultation,
  onDataChange,
}: CalendarTabProps) => {
  // USO CORRECTO DE workingSchedule
  const {
    baseDate,
    setBaseDate,
    calendarView,
    setCalendarView,
    workingSchedule,
    setWorkingSchedule,
  } = useCalendar();

  const confirmedAppointments = useMemo(
    () => appointments.filter((app) => app.status === "confirmed"),
    [appointments],
  );

  const patientOptions = useMemo(() => {
    const patientMap = new Map<string, string>();
    appointments.forEach((app) =>
      patientMap.set(app.patientId, app.patientName),
    );
    const uniquePatients = Array.from(patientMap.entries()).map(
      ([value, label]) => ({ label, value }),
    );
    return [
      ...uniquePatients,
      { label: "+ Crear nuevo paciente", value: "new", disabled: true },
    ];
  }, [appointments]);

  const serviceOptions = useMemo(() => {
    const uniqueServices = Array.from(
      new Set(appointments.map((app) => app.service)),
    );
    return uniqueServices.map((service) => ({
      label: service,
      value: service,
    }));
  }, [appointments]);

  const timeOptions = useMemo(() => {
    return Array.from({ length: 16 }, (_, i) => {
      const hour24 = i + 6;
      const ampm = hour24 >= 12 ? "PM" : "AM";
      const hour12 = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
      const timeStr = `${String(hour12).padStart(2, "0")}:00 ${ampm}`;
      return { label: timeStr, value: timeStr };
    });
  }, []);

  const handlePrevious = () => {
    const newDate = new Date(baseDate);
    if (calendarView === "day") newDate.setDate(newDate.getDate() - 1);
    if (calendarView === "week") newDate.setDate(newDate.getDate() - 7);
    if (calendarView === "month") newDate.setMonth(newDate.getMonth() - 1);
    setBaseDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(baseDate);
    if (calendarView === "day") newDate.setDate(newDate.getDate() + 1);
    if (calendarView === "week") newDate.setDate(newDate.getDate() + 7);
    if (calendarView === "month") newDate.setMonth(newDate.getMonth() + 1);
    setBaseDate(newDate);
  };

  const handleToday = () => setBaseDate(new Date());

  const getNavLabel = () => {
    if (calendarView === "day")
      return `${baseDate.toLocaleDateString("es-MX", { weekday: "long" })} ${baseDate.toLocaleDateString("es-MX", { day: "2-digit" })}`;
    if (calendarView === "week") {
      const dayOfWeek = baseDate.getDay();
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const start = new Date(baseDate);
      start.setDate(baseDate.getDate() + diffToMonday);
      const end = new Date(start);
      end.setDate(start.getDate() + 4);
      return `${start.toLocaleDateString("es-MX", { month: "short" }).replace(/\./g, "")} ${start.toLocaleDateString("es-MX", { day: "2-digit" })} - ${end.toLocaleDateString("es-MX", { month: "short" }).replace(/\./g, "")} ${end.toLocaleDateString("es-MX", { day: "2-digit" })}`;
    }
    return baseDate.toLocaleDateString("es-MX", { month: "long" });
  };

  const [selectedAppointment, setSelectedAppointment] =
    useState<DashboardAppointment | null>(null);
  // undefined while loading, null when nothing was charged yet.
  const [selectedPayment, setSelectedPayment] = useState<
    Payment | null | undefined
  >(undefined);
  const paymentRequestRef = useRef<string | null>(null);
  const [chargeTarget, setChargeTarget] = useState<{
    appointment: DashboardAppointment;
    payment: Payment | null;
  } | null>(null);

  const openAppointment = (appointment: DashboardAppointment) => {
    setSelectedAppointment(appointment);
    setSelectedPayment(undefined);
    paymentRequestRef.current = appointment.id;
    fetchPayment(appointment.id)
      .then((payment) => {
        if (paymentRequestRef.current === appointment.id) {
          setSelectedPayment(payment);
        }
      })
      .catch((err: unknown) => {
        console.error("Error al cargar el cobro:", err);
        if (paymentRequestRef.current === appointment.id) {
          setSelectedPayment(null);
        }
      });
  };

  const [isCancelingAppt, setIsCancelingAppt] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [isReschedulingAppt, setIsReschedulingAppt] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [isReschPickerOpen, setIsReschPickerOpen] = useState(false);

  const [selectedBlock, setSelectedBlock] =
    useState<DashboardBlockedSlot | null>(null);
  const [actionModal, setActionModal] = useState<{
    date: string;
    time: string;
  } | null>(null);
  const [actionTab, setActionTab] = useState<"schedule" | "block">("schedule");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const [selectedPatient, setSelectedPatient] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [blockStartDate, setBlockStartDate] = useState("");
  const [blockEndDate, setBlockEndDate] = useState("");
  const [blockStartTime, setBlockStartTime] = useState("09:00 AM");
  const [blockEndTime, setBlockEndTime] = useState("10:00 AM");
  const [blockReason, setBlockReason] = useState("comida");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [isStartPickerOpen, setIsStartPickerOpen] = useState(false);
  const [isEndPickerOpen, setIsEndPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftSchedule, setDraftSchedule] =
    useState<WeeklySchedule>(workingSchedule);

  const rescheduleOptions = useMemo(() => {
    if (!rescheduleDate || !selectedAppointment) return [];
    return getAvailableTimeOptions(
      rescheduleDate,
      appointments,
      blockedSlots,
      workingSchedule,
      selectedAppointment.durationMins,
    );
  }, [
    rescheduleDate,
    appointments,
    blockedSlots,
    workingSchedule,
    selectedAppointment,
  ]);

  // Cuando abran el modal, copiamos el horario actual al borrador
  useEffect(() => {
    if (settingsModalOpen) {
      setDraftSchedule(workingSchedule);
    }
  }, [settingsModalOpen, workingSchedule]);

  useEffect(() => {
    if (
      rescheduleOptions.length > 0 &&
      !rescheduleOptions.find((opt) => opt.value === rescheduleTime)
    ) {
      setRescheduleTime(rescheduleOptions[0].value);
    }
  }, [rescheduleOptions, rescheduleTime]);

  const handleOpenActionModal = (dateStr: string, timeStr: string) => {
    setActionModal({ date: dateStr, time: timeStr });
    setActionTab("schedule");
    const isoDate = parseVisualDateToISO(dateStr);
    setBlockStartDate(isoDate);
    setBlockEndDate(isoDate);
    setBlockStartTime(timeStr);
    const timeIndex = timeOptions.findIndex((t) => t.value === timeStr);
    const endTimeDefault =
      timeIndex !== -1 && timeIndex < timeOptions.length - 1
        ? timeOptions[timeIndex + 1].value
        : timeStr;
    setBlockEndTime(endTimeDefault);
    setEditingBlockId(null);
  };

  const handleScheduleAppointment = async () => {
    if (!actionModal || !selectedPatient || !selectedService) return;
    try {
      setIsSubmitting(true);
      await createAppointment(
        selectedPatient,
        selectedService,
        actionModal.date,
        actionModal.time,
      );
      await onDataChange();
      setActionModal(null);
    } catch (err: unknown) {
      console.error(
        "Error al agendar:",
        err instanceof Error ? err.message : err,
      );
      toast.error("Error al agendar cita.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelAppointment = async () => {
    if (!selectedAppointment || !cancelReason.trim()) return;
    try {
      setIsSubmitting(true);
      await cancelAppointment(selectedAppointment.id, cancelReason);
      await onDataChange();
      setSelectedAppointment(null);
      setIsCancelingAppt(false);
      setCancelReason("");
    } catch (err: unknown) {
      console.error(
        "Error al cancelar:",
        err instanceof Error ? err.message : err,
      );
      toast.error("Error al cancelar la cita.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmRescheduleAppt = async () => {
    if (!selectedAppointment || !rescheduleTime) return;
    try {
      setIsSubmitting(true);
      const utcIsoDateTime = combineIsoDateAndTime(
        rescheduleDate,
        rescheduleTime,
      );
      await rescheduleAppointment(selectedAppointment.id, utcIsoDateTime);
      await onDataChange();
      setSelectedAppointment(null);
      setIsReschedulingAppt(false);
    } catch (err: unknown) {
      console.error(
        "Error al reprogramar:",
        err instanceof Error ? err.message : err,
      );
      toast.error("Error al reprogramar.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveBlock = async () => {
    try {
      setIsSubmitting(true);
      if (editingBlockId) {
        await updateBlockedSlot(
          editingBlockId,
          blockStartDate,
          blockStartTime,
          blockEndDate,
          blockEndTime,
          blockReason,
        );
      } else {
        await createBlockedSlot(
          blockStartDate,
          blockStartTime,
          blockEndDate,
          blockEndTime,
          blockReason,
        );
      }
      await onDataChange();
      setActionModal(null);
      setEditingBlockId(null);
    } catch (err: unknown) {
      console.error(
        "Error al bloquear:",
        err instanceof Error ? err.message : err,
      );
      toast.error("Error al guardar el bloqueo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnblockSlot = async () => {
    if (!selectedBlock) return;
    try {
      setIsSubmitting(true);
      await deleteBlockedSlot(selectedBlock.id);
      await onDataChange();
      setSelectedBlock(null);
    } catch (err: unknown) {
      console.error(
        "Error al desbloquear:",
        err instanceof Error ? err.message : err,
      );
      toast.error("Error al desbloquear.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditBlock = () => {
    if (!selectedBlock) return;
    const isoDate = parseVisualDateToISO(selectedBlock.date);
    setBlockStartDate(isoDate);
    setBlockEndDate(isoDate);
    setBlockStartTime(selectedBlock.startTime);
    setBlockEndTime(selectedBlock.endTime);
    setBlockReason(selectedBlock.reason);
    setEditingBlockId(selectedBlock.id);
    setActionModal({ date: selectedBlock.date, time: selectedBlock.startTime });
    setActionTab("block");
    setSelectedBlock(null);
  };

  const handleSaveSettings = async () => {
    try {
      setIsSubmitting(true);
      await updateClinicSettings(draftSchedule);
      setWorkingSchedule(draftSchedule);
      setSettingsModalOpen(false);
    } catch (err: unknown) {
      console.error(
        "Error en config:",
        err instanceof Error ? err.message : err,
      );
      toast.error("Error al guardar la configuración.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col xl:flex-row items-center justify-between gap-4 bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-4 w-full xl:w-auto">
          <div className="w-12 h-12 bg-brand-light/30 text-brand-primary rounded-xl flex items-center justify-center shrink-0">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-brand-dark leading-tight capitalize">
              {baseDate
                .toLocaleDateString("es-MX", { month: "long", year: "numeric" })
                .replace(" de ", " ")}
            </h2>
            <p
              className="text-sm font-medium text-brand-gray mt-1 cursor-pointer hover:text-brand-primary transition-colors"
              onClick={handleToday}
            >
              Ir a hoy
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full xl:w-auto">
          <Button
            variant="outline"
            onClick={() => setSettingsModalOpen(true)}
            className="hidden xl:flex px-4 py-2 rounded-xl border-slate-200 text-brand-gray hover:bg-slate-50 cursor-pointer items-center gap-2"
          >
            <Settings className="w-4 h-4" /> Horarios de Clínica
          </Button>
          <div className="flex items-center bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-full sm:w-auto justify-center">
            {(["day", "week", "month"] as const).map((view) => (
              <button
                key={view}
                onClick={() => setCalendarView(view)}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all capitalize cursor-pointer ${calendarView === view ? "bg-white text-brand-dark shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
              >
                {view === "day" ? "Día" : view === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 shrink-0">
            <Button
              onClick={handlePrevious}
              variant="outline"
              className="p-2 rounded-xl border-none bg-white shadow-sm text-brand-dark cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <span className="font-semibold text-[13px] px-3 text-center min-w-30 capitalize">
              {getNavLabel()}
            </span>
            <Button
              onClick={handleNext}
              variant="outline"
              className="p-2 rounded-xl border-none bg-white shadow-sm text-brand-dark cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {calendarView === "day" && (
          <motion.div
            key="day"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <DailyView
              appointments={confirmedAppointments}
              blockedSlots={blockedSlots}
              onAppointmentClick={openAppointment}
              onBlockClick={setSelectedBlock}
              onEmptySlotClick={handleOpenActionModal}
            />
          </motion.div>
        )}
        {calendarView === "week" && (
          <motion.div
            key="week"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <WeeklyView
              appointments={confirmedAppointments}
              blockedSlots={blockedSlots}
              onAppointmentClick={openAppointment}
              onBlockClick={setSelectedBlock}
              onEmptySlotClick={handleOpenActionModal}
            />
          </motion.div>
        )}
        {calendarView === "month" && (
          <motion.div
            key="month"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <MonthlyView
              appointments={confirmedAppointments}
              blockedSlots={blockedSlots}
              onAppointmentClick={openAppointment}
              onBlockClick={setSelectedBlock}
              onEmptySlotClick={handleOpenActionModal}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        isOpen={!!selectedAppointment}
        onClose={() => {
          setSelectedAppointment(null);
          setIsReschedulingAppt(false);
          setIsCancelingAppt(false);
          setCancelReason("");
        }}
        title={
          isReschedulingAppt
            ? "Reprogramar Cita"
            : isCancelingAppt
              ? "Cancelar Cita"
              : "Detalles de la Cita"
        }
        icon={
          isReschedulingAppt || isCancelingAppt ? (
            <CalendarIcon className="w-5 h-5 text-brand-primary" />
          ) : (
            <User className="w-5 h-5 text-brand-primary" />
          )
        }
        hideFooter={true}
      >
        {selectedAppointment && (
          <div className="bg-slate-50/50 -m-6 p-6 space-y-4">
            {!isReschedulingAppt && !isCancelingAppt ? (
              <>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-brand-dark shrink-0 overflow-hidden border-2 border-white shadow-sm">
                    <User className="w-8 h-8 text-brand-gray" />
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-brand-dark leading-none">
                      {selectedAppointment.patientName}
                    </h3>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2 text-sm font-medium text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5" />{" "}
                        {selectedAppointment.phone}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                    <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest mb-1">
                      Fecha
                    </h4>
                    <p className="font-bold text-brand-dark">
                      {selectedAppointment.date}
                    </p>
                    <p className="text-sm font-medium text-slate-500">
                      {selectedAppointment.time} (
                      {selectedAppointment.durationMins} Min)
                    </p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                    <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest mb-1">
                      Tipo
                    </h4>
                    <p className="font-bold text-brand-primary">
                      {selectedAppointment.service}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-500">
                        {selectedPayment === undefined
                          ? "Cargando cobro..."
                          : selectedPayment === null
                            ? "Sin cobro registrado"
                            : selectedPayment.status === "courtesy"
                              ? "Cortesía"
                              : `Cobrado: ${formatMXN(selectedPayment.amountCharged)}`}
                      </p>
                      {selectedPayment !== undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            setChargeTarget({
                              appointment: selectedAppointment,
                              payment: selectedPayment,
                            });
                            setSelectedAppointment(null);
                          }}
                          className="text-sm font-bold text-brand-primary hover:underline cursor-pointer shrink-0"
                        >
                          {selectedPayment ? "Editar" : "Registrar"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="pt-4 flex flex-wrap sm:flex-nowrap gap-3 bg-white -mx-6 -mb-6 p-6 border-t border-slate-200">
                  <Button
                    variant="outline"
                    onClick={() => setIsCancelingAppt(true)}
                    disabled={isSubmitting}
                    className="flex-1 py-3.5 rounded-xl cursor-pointer font-bold border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300"
                  >
                    Cancelar Cita
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsReschedulingAppt(true);
                      setRescheduleDate(
                        parseVisualDateToISO(selectedAppointment.date),
                      );
                      setRescheduleTime(selectedAppointment.time);
                    }}
                    className="flex-1 py-3.5 rounded-xl cursor-pointer font-bold text-brand-primary border-brand-primary hover:bg-brand-light/30"
                  >
                    Reprogramar
                  </Button>
                  <Button
                    onClick={() => {
                      onStartConsultation(selectedAppointment);
                      setSelectedAppointment(null);
                    }}
                    className="flex-1 py-3.5 rounded-xl cursor-pointer bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md sm:w-auto w-full"
                  >
                    Iniciar
                  </Button>
                </div>
              </>
            ) : isCancelingAppt ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                <div className="bg-red-50 border border-red-100 p-4 rounded-xl space-y-3">
                  <label className="text-sm font-bold text-red-800 block">
                    Indique la razón de la cancelación
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Ej: El paciente avisó que no podía asistir..."
                    className="w-full p-3 border border-red-200 rounded-lg focus:outline-none focus:border-red-400 text-sm"
                    rows={3}
                  />
                </div>
                <div className="pt-4 flex gap-3 bg-white -mx-6 -mb-6 p-6 border-t border-slate-200">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsCancelingAppt(false);
                      setCancelReason("");
                    }}
                    className="flex-1 py-3.5 rounded-xl"
                  >
                    Atrás
                  </Button>
                  <Button
                    onClick={handleCancelAppointment}
                    disabled={isSubmitting || !cancelReason.trim()}
                    className="flex-1 py-3.5 rounded-xl bg-red-500 hover:bg-red-600 text-white border-none shadow-md disabled:opacity-50"
                  >
                    {isSubmitting ? "Cancelando..." : "Confirmar Cancelación"}
                  </Button>
                </div>
              </motion.div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 relative z-50">
                  <div>
                    <label className="text-brand-dark font-bold text-sm mb-2 block">
                      Nueva Fecha
                    </label>
                    <button
                      onClick={() => setIsReschPickerOpen(!isReschPickerOpen)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left focus:ring-2 focus:ring-brand-primary/20 transition-all flex items-center justify-between group cursor-pointer"
                    >
                      <span
                        className={
                          rescheduleDate ? "text-brand-dark" : "text-brand-gray"
                        }
                      >
                        {rescheduleDate || "Seleccionar..."}
                      </span>
                      <CalendarIcon className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
                    </button>
                    <div className="absolute top-full mt-2 z-50">
                      <DatePicker
                        isOpen={isReschPickerOpen}
                        onClose={() => setIsReschPickerOpen(false)}
                        selectedDate={rescheduleDate}
                        minDate={getISODate()}
                        onSelectDate={(d) => {
                          setRescheduleDate(d);
                          setIsReschPickerOpen(false);
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-brand-dark font-bold text-sm mb-2 block">
                      Nueva Hora
                    </label>
                    <Dropdown
                      options={
                        rescheduleOptions.length > 0
                          ? rescheduleOptions
                          : [{ label: "Sin horarios", value: "" }]
                      }
                      value={rescheduleTime}
                      onChange={setRescheduleTime}
                    />
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl">
                  <p className="text-xs text-amber-700 font-medium">
                    Nota: Al reprogramar, el estado de la cita cambiará a
                    "Pendiente" en la bandeja de entrada para llevar
                    seguimiento.
                  </p>
                </div>
                <div className="pt-4 flex gap-3 bg-white -mx-6 -mb-6 p-6 border-t border-slate-200">
                  <Button
                    variant="outline"
                    onClick={() => setIsReschedulingAppt(false)}
                    className="flex-1 py-3.5 rounded-xl"
                  >
                    Volver
                  </Button>
                  <Button
                    onClick={handleConfirmRescheduleAppt}
                    disabled={isSubmitting || !rescheduleTime}
                    className="flex-1 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white border-none shadow-md disabled:opacity-50"
                  >
                    {isSubmitting ? "Guardando..." : "Confirmar Reprogramación"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {chargeTarget && (
        <ChargeModal
          key={`charge-${chargeTarget.appointment.id}`}
          isOpen={true}
          onClose={() => setChargeTarget(null)}
          onSaved={() => setChargeTarget(null)}
          appointmentId={chargeTarget.appointment.id}
          subtitle={`${chargeTarget.appointment.patientName} · ${chargeTarget.appointment.service}`}
          servicePrice={chargeTarget.appointment.servicePrice}
          existing={chargeTarget.payment}
        />
      )}

      <Modal
        isOpen={!!actionModal}
        onClose={() => {
          setActionModal(null);
          setEditingBlockId(null);
        }}
        title={editingBlockId ? "Editar Bloqueo" : "Gestión de Agenda"}
        icon={
          editingBlockId ? (
            <Edit3 className="w-5 h-5 text-brand-primary" />
          ) : (
            <Plus className="w-5 h-5 text-brand-primary" />
          )
        }
        hideFooter={true}
      >
        {actionModal && (
          <div className="space-y-6 pb-2">
            {!editingBlockId && (
              <div className="flex p-1 bg-slate-100 rounded-xl">
                <button
                  onClick={() => setActionTab("schedule")}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all cursor-pointer ${actionTab === "schedule" ? "bg-white text-brand-primary shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
                >
                  Agendar Cita
                </button>
                <button
                  onClick={() => setActionTab("block")}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all cursor-pointer ${actionTab === "block" ? "bg-brand-primary text-white shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
                >
                  Bloquear Horario
                </button>
              </div>
            )}

            {actionTab === "schedule" && !editingBlockId && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                <div className="bg-brand-light/20 border border-brand-light/50 rounded-xl p-3 flex justify-between items-center text-sm">
                  <span className="text-brand-gray font-medium">
                    Horario sugerido:
                  </span>
                  <span className="font-bold text-brand-primary">
                    {actionModal.date} a las {actionModal.time}
                  </span>
                </div>
                <div className="relative z-50">
                  <label className="text-brand-dark font-bold text-sm mb-2 block">
                    Buscar Paciente
                  </label>
                  <Dropdown
                    options={patientOptions}
                    value={selectedPatient}
                    onChange={setSelectedPatient}
                    placeholder="Buscar por nombre..."
                    searchable={true}
                  />
                </div>
                <div className="relative z-40">
                  <label className="text-brand-dark font-bold text-sm mb-2 block">
                    Servicio a realizar
                  </label>
                  <Dropdown
                    options={serviceOptions}
                    value={selectedService}
                    onChange={setSelectedService}
                    placeholder="Seleccione un servicio..."
                  />
                </div>
                <Button
                  onClick={handleScheduleAppointment}
                  disabled={
                    isSubmitting || !selectedPatient || !selectedService
                  }
                  className="w-full py-3.5 rounded-xl bg-brand-primary hover:opacity-90 text-white mt-4 cursor-pointer border-none shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? "Guardando..." : "Confirmar Cita"}
                </Button>
              </motion.div>
            )}

            {actionTab === "block" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3 relative z-50">
                  <div>
                    <label className="text-brand-dark font-bold text-sm mb-2 block">
                      Desde (Fecha)
                    </label>
                    <button
                      onClick={() => setIsStartPickerOpen(!isStartPickerOpen)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left transition-all flex items-center justify-between group cursor-pointer"
                    >
                      <span
                        className={
                          blockStartDate ? "text-brand-dark" : "text-brand-gray"
                        }
                      >
                        {blockStartDate || "Seleccionar..."}
                      </span>
                      <CalendarIcon className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
                    </button>
                    <div className="absolute top-full mt-2 z-50">
                      <DatePicker
                        isOpen={isStartPickerOpen}
                        onClose={() => setIsStartPickerOpen(false)}
                        selectedDate={blockStartDate}
                        onSelectDate={(d) => {
                          setBlockStartDate(d);
                          setIsStartPickerOpen(false);
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-brand-dark font-bold text-sm mb-2 block">
                      Hasta (Fecha)
                    </label>
                    <button
                      onClick={() => setIsEndPickerOpen(!isEndPickerOpen)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left transition-all flex items-center justify-between group cursor-pointer"
                    >
                      <span
                        className={
                          blockEndDate ? "text-brand-dark" : "text-brand-gray"
                        }
                      >
                        {blockEndDate || "Seleccionar..."}
                      </span>
                      <CalendarIcon className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
                    </button>
                    <div className="absolute top-full right-0 mt-2 z-50">
                      <DatePicker
                        isOpen={isEndPickerOpen}
                        onClose={() => setIsEndPickerOpen(false)}
                        selectedDate={blockEndDate}
                        minDate={blockStartDate}
                        onSelectDate={(d) => {
                          setBlockEndDate(d);
                          setIsEndPickerOpen(false);
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 relative z-40">
                  <div>
                    <label className="text-brand-dark font-bold text-sm mb-2 block">
                      Hora Inicio
                    </label>
                    <Dropdown
                      options={timeOptions}
                      value={blockStartTime}
                      onChange={setBlockStartTime}
                    />
                  </div>
                  <div>
                    <label className="text-brand-dark font-bold text-sm mb-2 block">
                      Hora Fin
                    </label>
                    <Dropdown
                      options={timeOptions}
                      value={blockEndTime}
                      onChange={setBlockEndTime}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-brand-dark font-bold text-sm mb-3 block">
                    Motivo
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "comida", label: "Comida" },
                      { id: "junta", label: "Junta" },
                      { id: "personal", label: "Personal" },
                      { id: "vacaciones", label: "Vacaciones" },
                    ].map((reason) => (
                      <button
                        key={reason.id}
                        onClick={() => setBlockReason(reason.id)}
                        className={`py-2 px-2 rounded-lg border text-xs font-bold transition-all cursor-pointer ${blockReason === reason.id ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 bg-white text-brand-gray hover:border-slate-300"}`}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  onClick={handleSaveBlock}
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-xl bg-brand-primary hover:opacity-90 text-white mt-4 cursor-pointer border-none shadow-md disabled:opacity-50"
                >
                  {isSubmitting
                    ? "Guardando..."
                    : editingBlockId
                      ? "Actualizar Bloqueo"
                      : "Bloquear Fechas"}
                </Button>
              </motion.div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!selectedBlock}
        onClose={() => setSelectedBlock(null)}
        title="Detalles del Bloqueo"
        icon={<Ban className="w-5 h-5 text-fuchsia-500" />}
        hideFooter={true}
      >
        {selectedBlock && (
          <div className="space-y-6 pb-2 text-center">
            <div className="w-16 h-16 bg-fuchsia-50 rounded-full flex items-center justify-center mx-auto mb-2 text-fuchsia-500">
              <Ban className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-brand-dark uppercase tracking-widest">
              {selectedBlock.reason}
            </h3>
            <p className="text-brand-gray text-sm">
              Horario inhabilitado el <strong>{selectedBlock.date}</strong>{" "}
              <br /> de <strong>{selectedBlock.startTime}</strong> a{" "}
              <strong>{selectedBlock.endTime}</strong>.
            </p>
            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setSelectedBlock(null)}
                className="flex-1 py-3 rounded-xl cursor-pointer"
              >
                Cerrar
              </Button>
              <Button
                onClick={handleEditBlock}
                variant="outline"
                className="flex-1 py-3 rounded-xl cursor-pointer border-brand-primary text-brand-primary hover:bg-brand-light/30"
              >
                Editar
              </Button>
              <Button
                onClick={handleUnblockSlot}
                disabled={isSubmitting}
                className="flex-1 py-3 rounded-xl bg-fuchsia-500 hover:bg-fuchsia-600 text-white cursor-pointer border-none shadow-md disabled:opacity-50"
              >
                {isSubmitting ? "Borrando..." : "Desbloquear"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        title="Configuración Semanal"
        icon={<Settings className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        <div className="space-y-4 pb-2">
          <p className="text-brand-gray text-sm mb-4">
            Activa los días laborales y define el horario específico de entrada
            y salida para cada uno.
          </p>

          <div className="max-h-[50vh] overflow-y-auto pr-2 space-y-3">
            {[1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
              const dayNames: Record<number, string> = {
                1: "Lunes",
                2: "Martes",
                3: "Miércoles",
                4: "Jueves",
                5: "Viernes",
                6: "Sábado",
                0: "Domingo",
              };
              const day = draftSchedule[dayNum as keyof WeeklySchedule];
              if (!day) return null;

              return (
                <div
                  key={dayNum}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl border transition-all ${day.isOpen ? "border-brand-primary/30 bg-brand-light/5" : "border-slate-200 bg-slate-50 opacity-70"}`}
                >
                  <div className="flex items-center gap-3 mb-3 sm:mb-0">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={day.isOpen}
                        onChange={(e) =>
                          setDraftSchedule({
                            ...draftSchedule,
                            [dayNum]: { ...day, isOpen: e.target.checked },
                          })
                        }
                      />
                      <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-primary"></div>
                    </label>
                    <span
                      className={`font-bold text-sm ${day.isOpen ? "text-brand-dark" : "text-slate-400"}`}
                    >
                      {dayNames[dayNum]}
                    </span>
                  </div>

                  {day.isOpen ? (
                    <div className="flex items-center gap-2">
                      <div className="w-28 sm:w-32">
                        <Dropdown
                          options={timeOptions}
                          value={day.start}
                          onChange={(val) =>
                            setDraftSchedule({
                              ...draftSchedule,
                              [dayNum]: { ...day, start: val },
                            })
                          }
                        />
                      </div>
                      <span className="text-slate-400 font-medium text-xs">
                        a
                      </span>
                      <div className="w-28 sm:w-32">
                        <Dropdown
                          options={timeOptions}
                          value={day.end}
                          onChange={(val) =>
                            setDraftSchedule({
                              ...draftSchedule,
                              [dayNum]: { ...day, end: val },
                            })
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-slate-400 font-bold text-sm italic py-2 sm:py-0">
                      Día de descanso
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <Button
            onClick={handleSaveSettings}
            disabled={isSubmitting}
            className="w-full py-4 rounded-xl bg-brand-dark hover:bg-slate-800 text-white mt-4 cursor-pointer border-none shadow-md disabled:opacity-50 font-bold text-sm tracking-wide"
          >
            {isSubmitting ? "Guardando Cambios..." : "Guardar Esquema Semanal"}
          </Button>
        </div>
      </Modal>
    </motion.div>
  );
};
