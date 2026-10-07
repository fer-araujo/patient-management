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
import { TOUCH_ICON_BUTTON } from "../../../../components/ui/touchTargets";
import { useIsPhone } from "../../../../components/ui/useIsPhone";
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
  validateBlockRange,
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
import { RecordSuppliesModal } from "../modals/RecordSuppliesModal";
import { AppointmentPrescriptionActions } from "../../prescription/AppointmentPrescriptionActions";
import { useCalendar } from "../../hooks/useCalendar";
import { WeeklyView } from "./calendar/WeeklyView";
import { DailyView } from "./calendar/DailyView";
import { MonthlyView } from "./calendar/MonthlyView";
import {
  combineIsoDateAndTime,
  parseVisualDateToISO,
  getBookableTimeOptions,
} from "../../utils/calendarUtils";
import toast from "react-hot-toast";

const getISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Default length used to list free times before a service is chosen. */
const DEFAULT_SLOT_MINS = 30;

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

  // Portrait phones (below 768 px) have no Semana view: five day columns of
  // time slots would be ~75 px wide, or a sideways-scrolling grid, both hard
  // to read and to tap. Día and Mes cover the same ground there. Landscape
  // phones are wider than 768 px, so they get the tablet layout, Semana
  // included. A "week" chosen there shows as Día after rotating to portrait,
  // and comes back when the screen is wide again.
  const isPhone = useIsPhone();
  const activeView =
    isPhone && calendarView === "week" ? "day" : calendarView;
  const viewOptions = isPhone
    ? (["day", "month"] as const)
    : (["day", "week", "month"] as const);

  // Pending appointments (e.g. just rescheduled) stay visible: they hold their
  // slot. Completed consultations stay visible too, so one finalized without
  // its supplies can be found (in red) and completed.
  const calendarAppointments = useMemo(
    () =>
      appointments.filter(
        (app) =>
          app.status === "confirmed" ||
          app.status === "pending" ||
          app.status === "completed",
      ),
    [appointments],
  );

  const isClosedDay = (isoDate: string) => {
    const [y, m, d] = isoDate.split("-").map(Number);
    const day =
      workingSchedule[new Date(y, m - 1, d).getDay() as keyof WeeklySchedule];
    return !day?.isOpen;
  };

  const patientOptions = useMemo(() => {
    const patientMap = new Map<string, string>();
    // An archived record is inactive: it must be reactivated from the patient
    // directory before it can be booked (the server refuses it as well).
    appointments
      .filter((app) => app.patientStatus !== "archived")
      .forEach((app) => patientMap.set(app.patientId, app.patientName));
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
    if (activeView === "day") newDate.setDate(newDate.getDate() - 1);
    if (activeView === "week") newDate.setDate(newDate.getDate() - 7);
    if (activeView === "month") newDate.setMonth(newDate.getMonth() - 1);
    setBaseDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(baseDate);
    if (activeView === "day") newDate.setDate(newDate.getDate() + 1);
    if (activeView === "week") newDate.setDate(newDate.getDate() + 7);
    if (activeView === "month") newDate.setMonth(newDate.getMonth() + 1);
    setBaseDate(newDate);
  };

  const handleToday = () => setBaseDate(new Date());

  const getNavLabel = () => {
    if (activeView === "day")
      return `${baseDate.toLocaleDateString("es-MX", { weekday: "long" })} ${baseDate.toLocaleDateString("es-MX", { day: "2-digit" })}`;
    if (activeView === "week") {
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
  const [suppliesTarget, setSuppliesTarget] =
    useState<DashboardAppointment | null>(null);

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
  const [scheduleTime, setScheduleTime] = useState("");
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
    return getBookableTimeOptions(
      rescheduleDate,
      appointments,
      blockedSlots,
      workingSchedule,
      selectedAppointment.durationMins,
      selectedAppointment.id,
    );
  }, [
    rescheduleDate,
    appointments,
    blockedSlots,
    workingSchedule,
    selectedAppointment,
  ]);

  const scheduleDurationMins =
    appointments.find((app) => app.service === selectedService)
      ?.durationMins ?? DEFAULT_SLOT_MINS;

  const getScheduleOptions = (visualDate: string, durationMins: number) =>
    getBookableTimeOptions(
      parseVisualDateToISO(visualDate),
      appointments,
      blockedSlots,
      workingSchedule,
      durationMins,
    );

  const scheduleOptions = actionModal
    ? getScheduleOptions(actionModal.date, scheduleDurationMins)
    : [];

  // Cuando abran el modal, copiamos el horario actual al borrador
  useEffect(() => {
    if (settingsModalOpen) {
      setDraftSchedule(workingSchedule);
    }
  }, [settingsModalOpen, workingSchedule]);

  useEffect(() => {
    if (!rescheduleOptions.find((opt) => opt.value === rescheduleTime)) {
      // No free time (closed day, fully booked, or all past): leave it empty
      // so the confirm button stays disabled.
      setRescheduleTime(rescheduleOptions[0]?.value ?? "");
    }
  }, [rescheduleOptions, rescheduleTime]);

  /** "Agendar Cita" always starts empty: no patient or service from a previous booking. */
  const resetScheduleForm = () => {
    setSelectedPatient("");
    setSelectedService("");
    setScheduleTime("");
  };

  const closeActionModal = () => {
    setActionModal(null);
    setEditingBlockId(null);
    resetScheduleForm();
  };

  const handleOpenActionModal = (dateStr: string, timeStr: string) => {
    setActionModal({ date: dateStr, time: timeStr });
    setActionTab("schedule");
    setSelectedPatient("");
    setSelectedService("");
    // Preselect the clicked time only when it is really free; otherwise the
    // doctor has to pick one from the list. No service is chosen yet, so the
    // default slot length applies.
    const isClickedTimeFree = getScheduleOptions(
      dateStr,
      DEFAULT_SLOT_MINS,
    ).some((opt) => opt.value === timeStr);
    setScheduleTime(isClickedTimeFree ? timeStr : "");
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
    if (!actionModal || !selectedPatient || !selectedService || !scheduleTime)
      return;
    // The list can change after the time was picked (new data, longer
    // service): never book a time that now overlaps something else.
    if (!scheduleOptions.some((opt) => opt.value === scheduleTime)) {
      toast.error("Ese horario ya está ocupado. Elija otra hora.");
      return;
    }
    try {
      setIsSubmitting(true);
      await createAppointment(
        selectedPatient,
        selectedService,
        actionModal.date,
        scheduleTime,
      );
      await onDataChange();
      closeActionModal();
    } catch (err: unknown) {
      console.error(
        "Error al agendar:",
        err instanceof Error ? err.message : err,
      );
      toast.error(
        err instanceof Error ? err.message : "Error al agendar cita.",
      );
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

  const isRescheduleTimeValid = rescheduleOptions.some(
    (opt) => opt.value === rescheduleTime,
  );

  const handleConfirmRescheduleAppt = async () => {
    if (!selectedAppointment || !isRescheduleTimeValid) return;
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
      toast.error(err instanceof Error ? err.message : "Error al reprogramar.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveBlock = async () => {
    const rangeError = validateBlockRange(
      blockStartDate,
      blockStartTime,
      blockEndDate,
      blockEndTime,
    );
    if (rangeError) {
      toast.error(rangeError);
      return;
    }
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
      closeActionModal();
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
      {/* One row from lg (iPad landscape); below it the controls wrap under the title. */}
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4 bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-4 w-full lg:w-auto">
          <div className="w-12 h-12 bg-brand-light/30 text-brand-primary rounded-xl flex items-center justify-center shrink-0">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-brand-dark leading-tight capitalize">
              {baseDate
                .toLocaleDateString("es-MX", { month: "long", year: "numeric" })
                .replace(" de ", " ")}
            </h2>
            {/* On touch it looks like a button: a finger has no hover to discover it. */}
            <button
              type="button"
              onClick={handleToday}
              className="block w-fit text-left mt-1 text-sm font-medium text-brand-gray cursor-pointer hover:text-brand-primary transition-colors pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:rounded-xl pointer-coarse:border pointer-coarse:border-slate-200 pointer-coarse:bg-slate-50 pointer-coarse:text-brand-dark pointer-coarse:font-bold"
            >
              Ir a hoy
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-4 w-full lg:w-auto">
          {/* Short label below xl so the toolbar fits in one row on an iPad. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setSettingsModalOpen(true)}
            aria-label="Horarios de Clínica"
            className="flex w-auto! px-4 py-2 pointer-coarse:min-h-11 rounded-xl border-slate-200 text-brand-gray hover:bg-slate-50 cursor-pointer items-center gap-2 whitespace-nowrap"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
            <span className="xl:hidden">Horarios</span>
            <span className="hidden xl:inline">Horarios de Clínica</span>
          </Button>
          <div className="flex items-center bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-full sm:w-auto justify-center">
            {viewOptions.map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={activeView === view}
                onClick={() => setCalendarView(view)}
                className={`px-4 py-1.5 pointer-coarse:min-h-11 pointer-coarse:px-5 rounded-lg text-sm font-bold transition-all capitalize cursor-pointer max-md:flex-1 ${activeView === view ? "bg-white text-brand-dark shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
              >
                {view === "day" ? "Día" : view === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 shrink-0">
            <Button
              type="button"
              onClick={handlePrevious}
              variant="outline"
              aria-label="Anterior"
              className={`p-2 ${TOUCH_ICON_BUTTON} rounded-xl border-none bg-white shadow-sm text-brand-dark cursor-pointer`}
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <span className="font-semibold text-[13px] px-3 text-center min-w-30 capitalize">
              {getNavLabel()}
            </span>
            <Button
              type="button"
              onClick={handleNext}
              variant="outline"
              aria-label="Siguiente"
              className={`p-2 ${TOUCH_ICON_BUTTON} rounded-xl border-none bg-white shadow-sm text-brand-dark cursor-pointer`}
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeView === "day" && (
          <motion.div
            key="day"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <DailyView
              appointments={calendarAppointments}
              blockedSlots={blockedSlots}
              onAppointmentClick={openAppointment}
              onBlockClick={setSelectedBlock}
              onEmptySlotClick={handleOpenActionModal}
            />
          </motion.div>
        )}
        {activeView === "week" && (
          <motion.div
            key="week"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <WeeklyView
              appointments={calendarAppointments}
              blockedSlots={blockedSlots}
              onAppointmentClick={openAppointment}
              onBlockClick={setSelectedBlock}
              onEmptySlotClick={handleOpenActionModal}
            />
          </motion.div>
        )}
        {activeView === "month" && (
          <motion.div
            key="month"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <MonthlyView
              appointments={calendarAppointments}
              blockedSlots={blockedSlots}
              onAppointmentClick={openAppointment}
              onBlockClick={setSelectedBlock}
              onEmptySlotClick={handleOpenActionModal}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-xs text-brand-gray flex items-center gap-2">
        <span
          aria-hidden="true"
          className="w-3 h-3 rounded border bg-rose-50 border-rose-200 shrink-0"
        />
        En rojo: consultas sin insumos registrados.
      </p>

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
          <div className="bg-slate-50/50 -m-6 p-6 max-md:-mx-4 max-md:-my-5 max-md:p-4 space-y-4">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          className="text-sm font-bold text-brand-primary hover:underline cursor-pointer shrink-0 pointer-coarse:min-h-11 pointer-coarse:px-3"
                        >
                          {selectedPayment ? "Editar" : "Registrar"}
                        </button>
                      )}
                    </div>
                    {selectedAppointment.suppliesPending && (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-rose-600">
                          Sin insumos registrados
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setSuppliesTarget(selectedAppointment);
                            setSelectedAppointment(null);
                          }}
                          className="text-sm font-bold text-brand-primary hover:underline cursor-pointer shrink-0 pointer-coarse:min-h-11 pointer-coarse:px-3"
                        >
                          Registrar insumos
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {selectedAppointment.status === "completed" && (
                  <AppointmentPrescriptionActions
                    key={selectedAppointment.id}
                    appointmentId={selectedAppointment.id}
                    patientId={selectedAppointment.patientId}
                    patientName={selectedAppointment.patientName}
                    phone={selectedAppointment.phone}
                  />
                )}
                {/* A finalized consultation cannot be cancelled, moved or started again. */}
                {selectedAppointment.status !== "completed" && (
                <div className="pt-4 flex flex-wrap sm:flex-nowrap gap-3 bg-white -mx-6 -mb-6 p-6 max-md:-mx-4 max-md:-mb-4 max-md:p-4 border-t border-slate-200 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
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
                )}
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
                <div className="pt-4 flex gap-3 bg-white -mx-6 -mb-6 p-6 max-md:-mx-4 max-md:-mb-4 max-md:p-4 border-t border-slate-200 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
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
                    <label htmlFor="resch-date" className="text-brand-dark font-bold text-sm mb-2 block">
                      Nueva Fecha
                    </label>
                    <button
                      id="resch-date"
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
                        isDateDisabled={isClosedDay}
                        onSelectDate={(d) => {
                          setRescheduleDate(d);
                          setIsReschPickerOpen(false);
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label id="resch-time-label" className="text-brand-dark font-bold text-sm mb-2 block">
                      Nueva Hora
                    </label>
                    <Dropdown
                      labelledBy="resch-time-label"
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
                <div className="pt-4 flex gap-3 bg-white -mx-6 -mb-6 p-6 max-md:-mx-4 max-md:-mb-4 max-md:p-4 border-t border-slate-200 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
                  <Button
                    variant="outline"
                    onClick={() => setIsReschedulingAppt(false)}
                    className="flex-1 py-3.5 rounded-xl"
                  >
                    Volver
                  </Button>
                  <Button
                    onClick={handleConfirmRescheduleAppt}
                    disabled={isSubmitting || !isRescheduleTimeValid}
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

      {suppliesTarget && (
        <RecordSuppliesModal
          key={`supplies-${suppliesTarget.id}`}
          isOpen={true}
          onClose={() => setSuppliesTarget(null)}
          onSaved={() => {
            setSuppliesTarget(null);
            // Reloads the calendar so the appointment is no longer red.
            void onDataChange();
          }}
          appointmentId={suppliesTarget.id}
          serviceId={suppliesTarget.serviceId}
          subtitle={`${suppliesTarget.patientName} · ${suppliesTarget.service}`}
        />
      )}

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
        onClose={closeActionModal}
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
                  className={`flex-1 py-2 pointer-coarse:min-h-11 text-sm font-bold rounded-lg transition-all cursor-pointer ${actionTab === "schedule" ? "bg-white text-brand-primary shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
                >
                  Agendar Cita
                </button>
                <button
                  onClick={() => setActionTab("block")}
                  className={`flex-1 py-2 pointer-coarse:min-h-11 text-sm font-bold rounded-lg transition-all cursor-pointer ${actionTab === "block" ? "bg-brand-primary text-white shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
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
                  <span className="text-brand-gray font-medium">Fecha:</span>
                  <span className="font-bold text-brand-primary">
                    {actionModal.date}
                  </span>
                </div>
                <div className="relative z-50">
                  <label id="schedule-patient-label" className="text-brand-dark font-bold text-sm mb-2 block">
                    Buscar Paciente
                  </label>
                  <Dropdown
                    labelledBy="schedule-patient-label"
                    options={patientOptions}
                    value={selectedPatient}
                    onChange={setSelectedPatient}
                    placeholder="Buscar por nombre..."
                    searchable={true}
                  />
                </div>
                <div className="relative z-40">
                  <label id="schedule-service-label" className="text-brand-dark font-bold text-sm mb-2 block">
                    Servicio a realizar
                  </label>
                  <Dropdown
                    labelledBy="schedule-service-label"
                    options={serviceOptions}
                    value={selectedService}
                    onChange={setSelectedService}
                    placeholder="Seleccione un servicio..."
                  />
                </div>
                <div className="relative z-30">
                  <label id="schedule-time-label" className="text-brand-dark font-bold text-sm mb-2 block">
                    Hora
                  </label>
                  <Dropdown
                    labelledBy="schedule-time-label"
                    options={
                      scheduleOptions.length > 0
                        ? scheduleOptions
                        : [{ label: "Sin horarios", value: "" }]
                    }
                    value={scheduleTime}
                    onChange={setScheduleTime}
                    placeholder="Seleccione una hora..."
                  />
                </div>
                <Button
                  onClick={handleScheduleAppointment}
                  disabled={
                    isSubmitting ||
                    !selectedPatient ||
                    !selectedService ||
                    !scheduleTime
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
                    <label htmlFor="block-start-date" className="text-brand-dark font-bold text-sm mb-2 block">
                      Desde (Fecha)
                    </label>
                    <button
                      id="block-start-date"
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
                        maxDate={blockEndDate}
                        onSelectDate={(d) => {
                          setBlockStartDate(d);
                          setIsStartPickerOpen(false);
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="block-end-date" className="text-brand-dark font-bold text-sm mb-2 block">
                      Hasta (Fecha)
                    </label>
                    <button
                      id="block-end-date"
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
                    <label id="block-start-time-label" className="text-brand-dark font-bold text-sm mb-2 block">
                      Hora Inicio
                    </label>
                    <Dropdown
                      labelledBy="block-start-time-label"
                      options={timeOptions}
                      value={blockStartTime}
                      onChange={setBlockStartTime}
                    />
                  </div>
                  <div>
                    <label id="block-end-time-label" className="text-brand-dark font-bold text-sm mb-2 block">
                      Hora Fin
                    </label>
                    <Dropdown
                      labelledBy="block-end-time-label"
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
                        className={`py-2 px-2 pointer-coarse:min-h-11 pointer-coarse:text-sm rounded-lg border text-xs font-bold transition-all cursor-pointer ${blockReason === reason.id ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 bg-white text-brand-gray hover:border-slate-300"}`}
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
            <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
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
                    <label className="relative inline-flex items-center cursor-pointer pointer-coarse:min-h-11">
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
