import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Check,
  X,
  Calendar,
  Clock,
  Search,
  SlidersHorizontal,
  CalendarClock,
  Inbox,
  CheckCircle2,
  Users,
  TrendingUp,
  CalendarX2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../../../../components/ui/Button";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import { Modal } from "../../../../components/ui/Modal";
import { DatePicker } from "../../../../components/ui/DatePicker";
import { Dropdown } from "../../../../components/ui/Dropdown";
import {
  updateAppointmentStatus,
  rescheduleAppointment,
  cancelAppointment,
  type DashboardAppointment,
} from "../../../../lib/services/clinicService";
import { type DashboardBlockedSlot } from "../../../../lib/services/blockedSlotsService";
import {
  combineIsoDateAndTime,
  getAvailableTimeOptions,
} from "../../utils/calendarUtils";
import { useCalendar } from "../../hooks/useCalendar";

const getISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface InboxTabProps {
  appointments: DashboardAppointment[];
  blockedSlots: DashboardBlockedSlot[];
  onDataChange: () => Promise<void>;
}

export const InboxTab = ({
  appointments: initialAppointments,
  blockedSlots,
  onDataChange,
}: InboxTabProps) => {
  const [appointments, setAppointments] =
    useState<DashboardAppointment[]>(initialAppointments);
  const { workingHours } = useCalendar();

  useEffect(() => {
    setAppointments(initialAppointments);
  }, [initialAppointments]);

  const [searchTerm, setSearchTerm] = useState("");
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [draftStatusFilter, setDraftStatusFilter] = useState<string>("all");

  const [rescheduleData, setRescheduleData] =
    useState<DashboardAppointment | null>(null);
  const [newDateISO, setNewDateISO] = useState("");
  const [newTime, setNewTime] = useState("09:00 AM");
  const [isRescheduleDatePickerOpen, setIsRescheduleDatePickerOpen] =
    useState(false);

  const [cancelModalData, setCancelModalData] =
    useState<DashboardAppointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rejectModalData, setRejectModalData] =
    useState<DashboardAppointment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // MOTOR DINÁMICO DE HUECOS
  const durationMins = useMemo(() => {
    if (!rescheduleData) return 60;
    return (
      appointments.find((a) => a.id === rescheduleData.id)?.durationMins || 60
    );
  }, [rescheduleData, appointments]);

  const availableTimeOptions = useMemo(() => {
    if (!newDateISO) return [];
    return getAvailableTimeOptions(
      newDateISO,
      appointments,
      blockedSlots,
      workingHours,
      durationMins,
    );
  }, [newDateISO, appointments, blockedSlots, workingHours, durationMins]);

  useEffect(() => {
    if (
      availableTimeOptions.length > 0 &&
      !availableTimeOptions.find((opt) => opt.value === newTime)
    ) {
      setNewTime(availableTimeOptions[0].value);
    }
  }, [availableTimeOptions, newTime]);

  // ACCIONES CON TIPADO STRICTO Y MANEJO DE ERRORES
  const handleApprove = async (id: string) => {
    try {
      await updateAppointmentStatus(id, "confirmed");
      await onDataChange();
    } catch (err: unknown) {
      console.error(
        "Error al aprobar:",
        err instanceof Error ? err.message : err,
      );
      alert("No se pudo aprobar la cita.");
    }
  };

  const openRescheduleModal = (appointment: DashboardAppointment) => {
    setRescheduleData(appointment);
    setNewDateISO(getISODate());
    setNewTime(appointment.time);
  };

  const confirmReject = async () => {
    if (!rejectModalData) return;
    try {
      setIsSubmitting(true);
      await updateAppointmentStatus(rejectModalData.id, "rejected");
      await onDataChange();
      setRejectModalData(null);
    } catch (err: unknown) {
      console.error(
        "Error al rechazar:",
        err instanceof Error ? err.message : err,
      );
      alert("No se pudo rechazar la cita.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelModalData || !cancelReason.trim()) return;
    try {
      setIsSubmitting(true);
      await cancelAppointment(cancelModalData.id, cancelReason); // AHORA PIDE MOTIVO
      await onDataChange();
      setCancelModalData(null);
      setCancelReason("");
    } catch (err: unknown) {
      console.error(
        "Error al cancelar:",
        err instanceof Error ? err.message : err,
      );
      alert("No se pudo cancelar la cita.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReschedule = async () => {
    if (!rescheduleData || !newTime) return;
    try {
      setIsSubmitting(true);
      const utcIsoDateTime = combineIsoDateAndTime(newDateISO, newTime);
      await rescheduleAppointment(rescheduleData.id, utcIsoDateTime);
      await onDataChange();
      setRescheduleData(null);
    } catch (err: unknown) {
      console.error(
        "Error al reprogramar:",
        err instanceof Error ? err.message : err,
      );
      alert("Hubo un error al reprogramar la cita.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const stats = useMemo(
    () => ({
      pending: appointments.filter((a) => a.status === "pending").length,
      confirmed: appointments.filter((a) => a.status === "confirmed").length,
      newPatients: appointments.filter((a) => a.isNewPatient).length,
      total: appointments.length,
    }),
    [appointments],
  );

  const filteredData = useMemo(() => {
    return appointments.filter((app) => {
      const matchesSearch =
        app.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.service.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || app.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [appointments, searchTerm, statusFilter]);

  const columns: ColumnDef<DashboardAppointment>[] = [
    {
      header: "Paciente",
      accessorKey: "patientName",
      sortable: true,
      className: "w-[25%]",
      cell: (row) => (
        <div className="flex flex-col items-start">
          <span className="font-bold text-brand-dark text-base">
            {row.patientName}
          </span>
          {row.isNewPatient && (
            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md mt-1 uppercase tracking-wider">
              NUEVO
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Servicio",
      accessorKey: "service",
      sortable: true,
      className: "w-[25%]",
      cell: (row) => (
        <span className="text-sm font-bold text-brand-primary bg-brand-light/30 px-3 py-1.5 rounded-lg inline-block">
          {row.service}
        </span>
      ),
    },
    {
      header: "Fecha / Hora",
      accessorKey: "date",
      sortable: true,
      className: "w-[20%]",
      cell: (row) => (
        <div className="flex flex-col gap-1.5 text-sm font-medium text-brand-dark">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-brand-gray/50" /> {row.date}
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-brand-gray/50" /> {row.time}
          </div>
        </div>
      ),
    },
    {
      header: "Estado",
      accessorKey: "status",
      sortable: true,
      className: "w-[15%]",
      cell: (row) => {
        const statusConfig = {
          pending: {
            color: "text-amber-600 bg-amber-50 border-amber-200",
            label: "Pendiente",
          },
          confirmed: {
            color: "text-teal-600 bg-teal-50 border-teal-200",
            label: "Confirmada",
          },
          completed: {
            color: "text-blue-600 bg-blue-50 border-blue-200",
            label: "Completada",
          },
          cancelled: {
            color: "text-rose-600 bg-rose-50 border-rose-200",
            label: "Cancelada",
          },
          rejected: {
            color: "text-red-600 bg-red-50 border-red-200",
            label: "Rechazada",
          },
        };
        const config = statusConfig[row.status];
        return (
          <span
            className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border ${config.color}`}
          >
            {config.label}
          </span>
        );
      },
    },
    {
      header: "Acciones",
      className: "w-[15%] text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          {row.status === "pending" && (
            <>
              <button
                onClick={() => handleApprove(row.id)}
                className="flex items-center justify-center w-10 h-10 bg-teal-50 text-teal-600 hover:bg-teal-500 hover:text-white rounded-xl transition-all border border-teal-100 hover:border-teal-500 shadow-sm cursor-pointer"
                title="Aprobar"
              >
                <Check className="w-5 h-5" strokeWidth={2.5} />
              </button>
              <button
                onClick={() => openRescheduleModal(row)}
                className="flex items-center justify-center w-10 h-10 bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white rounded-xl transition-all border border-amber-100 hover:border-amber-500 shadow-sm cursor-pointer"
                title="Sugerir horario"
              >
                <CalendarClock className="w-5 h-5" strokeWidth={2.5} />
              </button>
              <button
                onClick={() => setRejectModalData(row)}
                className="flex items-center justify-center w-10 h-10 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white rounded-xl transition-all border border-red-100 hover:border-red-500 shadow-sm cursor-pointer"
                title="Rechazar Solicitud"
              >
                <X className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </>
          )}
          {row.status === "confirmed" && (
            <>
              <button
                onClick={() => openRescheduleModal(row)}
                className="flex items-center justify-center w-10 h-10 bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white rounded-xl transition-all border border-blue-100 hover:border-blue-500 shadow-sm cursor-pointer"
                title="Reprogramar"
              >
                <CalendarClock className="w-5 h-5" strokeWidth={2.5} />
              </button>
              <button
                onClick={() => {
                  setCancelModalData(row);
                  setCancelReason("");
                }}
                className="flex items-center justify-center w-10 h-10 bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white rounded-xl transition-all border border-rose-100 hover:border-rose-500 shadow-sm cursor-pointer"
                title="Cancelar Cita"
              >
                <CalendarX2 className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </>
          )}
          {(row.status === "completed" ||
            row.status === "cancelled" ||
            row.status === "rejected") && (
            <span className="text-sm font-bold text-slate-400 mr-2">
              {row.status === "completed"
                ? "Finalizada"
                : row.status === "cancelled"
                  ? "Cancelada"
                  : "Rechazada"}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <Inbox className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Por Revisar
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.pending}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-teal-50 text-teal-500 rounded-2xl flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Confirmadas
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.confirmed}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center shrink-0">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Nuevos Pac.
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.newPatients}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <TrendingUp className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Total Agenda
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.total}
            </h4>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-2">
        <div className="relative w-full sm:w-96">
          <Search className="w-5 h-5 text-brand-gray absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar paciente o servicio..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 shadow-[0_2px_10px_rgb(0,0,0,0.02)] rounded-xl text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setDraftStatusFilter(statusFilter);
            setIsFilterModalOpen(true);
          }}
          className="px-5 py-2.5 rounded-xl border-slate-200 bg-white shadow-[0_2px_10px_rgb(0,0,0,0.02)] text-brand-dark hover:bg-slate-50 cursor-pointer flex items-center justify-center gap-2 font-bold w-full sm:w-auto shrink-0"
        >
          <SlidersHorizontal className="w-4 h-4" /> Filtros Avanzados
          {statusFilter !== "all" && (
            <span className="w-2 h-2 rounded-full bg-brand-primary ml-1"></span>
          )}
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <DataGrid
          data={filteredData}
          columns={columns}
          keyExtractor={(row) => row.id}
          itemsPerPage={10}
        />
      </div>

      <Modal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        title="Filtros Avanzados"
        icon={<SlidersHorizontal className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        <div className="space-y-6 pb-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { id: "all", label: "Todas" },
              { id: "pending", label: "Pendientes" },
              { id: "confirmed", label: "Confirmadas" },
              { id: "cancelled", label: "Canceladas" },
              { id: "rejected", label: "Rechazadas" },
            ].map((status) => (
              <button
                key={status.id}
                onClick={() => setDraftStatusFilter(status.id)}
                className={`py-3 px-4 rounded-xl border-2 text-sm font-bold transition-all cursor-pointer ${draftStatusFilter === status.id ? "border-brand-primary bg-brand-light/30 text-brand-primary" : "border-slate-100 bg-white text-brand-gray hover:border-slate-200"}`}
              >
                {status.label}
              </button>
            ))}
          </div>
          <div className="pt-4 border-t border-slate-100 flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setStatusFilter("all");
                setIsFilterModalOpen(false);
              }}
              className="flex-1 py-3 rounded-xl cursor-pointer"
            >
              Limpiar
            </Button>
            <Button
              onClick={() => {
                setStatusFilter(draftStatusFilter);
                setIsFilterModalOpen(false);
              }}
              className="flex-1 py-3 rounded-xl cursor-pointer"
            >
              Aplicar Filtros
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!cancelModalData}
        onClose={() => {
          setCancelModalData(null);
          setCancelReason("");
        }}
        title="Cancelar Cita"
        icon={<AlertTriangle className="w-5 h-5 text-rose-500" />}
        hideFooter={true}
      >
        {cancelModalData && (
          <div className="space-y-6 pb-2 text-center">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-2 text-rose-500">
              <CalendarX2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-brand-dark">
              ¿Estás segura?
            </h3>
            <p className="text-brand-gray">
              Estás a punto de cancelar la cita de{" "}
              <strong>{cancelModalData.patientName}</strong>.
            </p>
            <div className="text-left mt-4 space-y-2">
              <label className="text-sm font-bold text-brand-dark">
                Motivo de cancelación
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ej: El paciente avisó que no llegaría..."
                className="w-full p-3 border border-slate-200 rounded-lg focus:outline-none focus:border-brand-primary text-sm"
                rows={3}
              />
            </div>
            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setCancelModalData(null);
                  setCancelReason("");
                }}
                className="flex-1 py-3 rounded-xl cursor-pointer"
              >
                Mantener Cita
              </Button>
              <Button
                onClick={confirmCancel}
                disabled={isSubmitting || !cancelReason.trim()}
                className="flex-1 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white cursor-pointer border-none disabled:opacity-50"
              >
                {isSubmitting ? "Cancelando..." : "Sí, Cancelar"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!rescheduleData}
        onClose={() => setRescheduleData(null)}
        title={
          rescheduleData?.status === "pending"
            ? "Sugerir Horario"
            : "Reprogramar Cita"
        }
        icon={<CalendarClock className="w-5 h-5 text-amber-500" />}
        hideFooter={true}
      >
        {rescheduleData && (
          <div className="space-y-6 pb-2">
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
              <p className="text-sm text-brand-gray font-medium mb-1">
                Paciente:
              </p>
              <p className="text-base font-bold text-brand-dark">
                {rescheduleData.patientName}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-brand-dark font-bold text-sm mb-2 block">
                  Nueva Fecha
                </label>
                <button
                  onClick={() => setIsRescheduleDatePickerOpen(true)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left focus:ring-2 focus:ring-brand-primary/20 transition-all flex items-center justify-between group cursor-pointer"
                >
                  <span
                    className={
                      newDateISO ? "text-brand-dark" : "text-brand-gray"
                    }
                  >
                    {newDateISO || "Seleccionar..."}
                  </span>
                  <Calendar className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
                </button>
                <div className="absolute top-full mt-2 z-50">
                  <DatePicker
                    isOpen={isRescheduleDatePickerOpen}
                    onClose={() => setIsRescheduleDatePickerOpen(false)}
                    selectedDate={newDateISO}
                    minDate={getISODate()}
                    onSelectDate={(d) => {
                      setNewDateISO(d);
                      setIsRescheduleDatePickerOpen(false);
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
                    availableTimeOptions.length > 0
                      ? availableTimeOptions
                      : [{ label: "Sin horarios", value: "" }]
                  }
                  value={newTime}
                  onChange={setNewTime}
                />
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setRescheduleData(null)}
                className="flex-1 py-3 rounded-xl cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmReschedule}
                disabled={!newTime || isSubmitting}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white cursor-pointer border-none disabled:opacity-50"
              >
                {isSubmitting ? "Enviando..." : "Confirmar y Avisar"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!rejectModalData}
        onClose={() => setRejectModalData(null)}
        title="Rechazar Solicitud"
        icon={<X className="w-5 h-5 text-red-500" />}
        hideFooter={true}
      >
        {rejectModalData && (
          <div className="space-y-6 pb-2 text-center">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-2 text-red-500">
              <X className="w-8 h-8" strokeWidth={3} />
            </div>
            <h3 className="text-xl font-bold text-brand-dark">
              ¿Rechazar esta solicitud?
            </h3>
            <p className="text-brand-gray">
              Estás a punto de rechazar la solicitud de cita de{" "}
              <strong>{rejectModalData.patientName}</strong>. El paciente
              recibirá un aviso.
            </p>
            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setRejectModalData(null)}
                className="flex-1 py-3 rounded-xl cursor-pointer"
              >
                Mantener
              </Button>
              <Button
                onClick={confirmReject}
                disabled={isSubmitting}
                className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white cursor-pointer border-none disabled:opacity-50"
              >
                {isSubmitting ? "Rechazando..." : "Sí, Rechazar"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};
