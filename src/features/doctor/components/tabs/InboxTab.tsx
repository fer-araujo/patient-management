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
  TOUCH_LABELED_BUTTON,
  TOUCH_ONLY_LABEL,
  PHONE_LABELED_BUTTON,
  PHONE_ONLY_LABEL,
} from "../../../../components/ui/touchTargets";
import {
  updateAppointmentStatus,
  rescheduleAppointment,
  cancelAppointment,
  type DashboardAppointment,
} from "../../../../lib/services/clinicService";
import { type DashboardBlockedSlot } from "../../../../lib/services/blockedSlotsService";
import {
  combineIsoDateAndTime,
  getBookableTimeOptions,
  hasAppointmentStarted,
  parseVisualDateToISO,
} from "../../utils/calendarUtils";
import { useCalendar } from "../../hooks/useCalendar";
import { useClinicMode } from "../../../clinicMode/useClinicMode";
import { toast } from "react-hot-toast/headless";
import { nowInClinic } from "../../../../lib/clinicTime";

/** How often "Vencida" labels, cards and bookable slots are re-evaluated. */
const NOW_REFRESH_MS = 60_000;

/**
 * The patient's reason, clamped to two lines so a long one cannot stretch the
 * row. Tapping it shows the full text: a tablet has no hover tooltip.
 */
const ExpandableReason = ({ reason }: { reason: string }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setExpanded((open) => !open)}
      aria-expanded={expanded}
      title={reason}
      className="block w-full text-left text-sm text-brand-gray font-medium mt-1 break-words cursor-pointer"
    >
      {/* Clamped on an inner span: some browsers ignore line-clamp on a
          button box itself. */}
      <span className={expanded ? "block" : "line-clamp-2"}>{reason}</span>
    </button>
  );
};

/**
 * The Agenda shows appointments from 30 days ago onward (past ones for
 * context, plus everything upcoming). Shared by the table and the cards so
 * both always count the same set.
 */
const isWithinInboxWindow = (app: DashboardAppointment): boolean => {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 30);
  windowStart.setHours(0, 0, 0, 0);
  const isoDate = parseVisualDateToISO(app.date);
  return new Date(`${isoDate}T00:00:00`) >= windowStart;
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

  // FIX BUG: Extraemos correctamente el workingSchedule (JSON) en lugar del workingHours viejo
  const { workingSchedule } = useCalendar();
  // Doctor-only mode: no online requests arrive, so there is nothing to
  // approve, suggest or reject. A request left from before the switch is
  // handled like any appointment (confirm, move or cancel).
  const { doctorOnlyMode } = useClinicMode();

  useEffect(() => {
    setAppointments(initialAppointments);
  }, [initialAppointments]);

  // One shared clock for the cards, the row labels and the bookable slots,
  // so they always agree on what is "Vencida". Refreshed every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

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

  // =========================================================================
  // MOTOR DINÁMICO DE HUECOS
  // =========================================================================
  const durationMins = useMemo(() => {
    if (!rescheduleData) return 60;
    return (
      appointments.find((a) => a.id === rescheduleData.id)?.durationMins || 60
    );
  }, [rescheduleData, appointments]);

  const availableTimeOptions = useMemo(() => {
    if (!newDateISO || !workingSchedule) return [];
    // Only slots that have not started yet: the server refuses a start at or
    // before now(). `now` is a dependency so the list follows the clock.
    return getBookableTimeOptions(
      newDateISO,
      appointments,
      blockedSlots,
      workingSchedule,
      durationMins,
      // The request being moved must not block its own current slot.
      rescheduleData?.id,
      now,
    );
  }, [
    newDateISO,
    appointments,
    blockedSlots,
    workingSchedule,
    durationMins,
    rescheduleData,
    now,
  ]);

  const isNewTimeBookable = availableTimeOptions.some(
    (opt) => opt.value === newTime,
  );

  useEffect(() => {
    if (isNewTimeBookable) return;
    // Fall back to the first bookable slot, or to none ("Sin horarios").
    setNewTime(availableTimeOptions[0]?.value ?? "");
  }, [availableTimeOptions, isNewTimeBookable]);

  // =========================================================================
  // ACCIONES CON TIPADO STRICTO Y MANEJO DE ERRORES
  // =========================================================================
  const handleApprove = async (id: string) => {
    try {
      await updateAppointmentStatus(id, "confirmed");
      await onDataChange();
    } catch (err: unknown) {
      console.error(
        "Error al aprobar:",
        err instanceof Error ? err.message : err,
      );
      toast.error("No se pudo aprobar la cita.");
    }
  };

  const openRescheduleModal = (appointment: DashboardAppointment) => {
    setRescheduleData(appointment);
    // A past ("Vencida") appointment cannot be moved to its own day: start
    // from the clinic's today instead.
    const clinicToday = nowInClinic().isoDate;
    const currentDate = parseVisualDateToISO(appointment.date);
    setNewDateISO(currentDate < clinicToday ? clinicToday : currentDate);
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
      toast.error("No se pudo rechazar la cita.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelModalData || !cancelReason.trim()) return;
    try {
      setIsSubmitting(true);
      await cancelAppointment(cancelModalData.id, cancelReason);
      await onDataChange();
      setCancelModalData(null);
      setCancelReason("");
    } catch (err: unknown) {
      console.error(
        "Error al cancelar:",
        err instanceof Error ? err.message : err,
      );
      toast.error("No se pudo cancelar la cita.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReschedule = async () => {
    if (!rescheduleData || !newTime || !isNewTimeBookable) return;
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
      toast.error("Hubo un error al reprogramar la cita.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // =========================================================================
  // DATOS DERIVADOS Y REGLAS DE NEGOCIO (INBOX FILTERING)
  // =========================================================================
  // The cards count exactly what the table shows (same 30-day window), and
  // "Por revisar" / "Confirmadas" only count what is still ahead: a pending
  // request or a confirmed visit whose time already passed needs no action.
  const stats = useMemo(() => {
    const upcoming = (a: DashboardAppointment) =>
      !hasAppointmentStarted(a, now);
    const inWindow = appointments.filter(isWithinInboxWindow);
    return {
      pending: appointments.filter((a) => a.status === "pending" && upcoming(a))
        .length,
      confirmed: appointments.filter(
        (a) => a.status === "confirmed" && upcoming(a),
      ).length,
      newPatients: inWindow.filter((a) => a.isNewPatient).length,
      total: inWindow.length,
    };
  }, [appointments, now]);

  const filteredData = useMemo(() => {
    const filtered = appointments.filter((app) => {
      // REGLA DE NEGOCIO: Excluir citas con más de 30 días de antigüedad
      const isWithin30Days = isWithinInboxWindow(app);
      const matchesSearch =
        app.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.service.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || app.status === statusFilter;

      return isWithin30Days && matchesSearch && matchesStatus;
    });

    // 3. REGLA DE NEGOCIO: Ordenar inteligentemente
    return filtered.sort((a, b) => {
      // Prioridad 1: Estado "Pendiente" siempre hasta arriba
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;

      // Prioridad 2: Orden Cronológico (de la más próxima a la más lejana)
      const dateA = new Date(
        combineIsoDateAndTime(parseVisualDateToISO(a.date), a.time),
      ).getTime();
      const dateB = new Date(
        combineIsoDateAndTime(parseVisualDateToISO(b.date), b.time),
      ).getTime();

      return dateA - dateB;
    });
  }, [appointments, searchTerm, statusFilter]);

  const columns: ColumnDef<DashboardAppointment>[] = [
    {
      header: "Paciente",
      mobileRole: "title",
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
      mobileRole: "subtitle",
      accessorKey: "service",
      sortable: true,
      className: "w-[25%]",
      cell: (row) => (
        <div className="flex flex-col items-start">
          <span className="text-sm font-bold text-brand-primary bg-brand-light/30 px-3 py-1.5 rounded-lg inline-block">
            {row.service}
          </span>
          {row.reason && <ExpandableReason reason={row.reason} />}
        </div>
      ),
    },
    {
      header: "Fecha / Hora",
      mobileRole: "meta",
      mobileLabel: "Fecha y hora",
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
      mobileRole: "status",
      accessorKey: "status",
      sortable: true,
      className: "w-[15%]",
      cell: (row) => {
        // A pending appointment whose start already passed cannot be
        // confirmed any more; it is labelled "Vencida" in the same pill.
        const overdue =
          row.status === "pending" && hasAppointmentStarted(row, now);
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
            {overdue ? "Vencida" : config.label}
          </span>
        );
      },
    },
    {
      header: "Acciones",
      mobileRole: "actions",
      className: "w-[15%] text-right",
      stickyRight: true,
      cell: (row) => {
        // Pending with its start already passed: only move or cancel it.
        const overdue =
          row.status === "pending" && hasAppointmentStarted(row, now);
        const awaitingAction = row.status === "pending" && !overdue;
        return (
          <div className="flex items-center justify-end gap-2">
            {awaitingAction && doctorOnlyMode && (
              <button
                type="button"
                onClick={() => handleApprove(row.id)}
                className="flex items-center justify-center gap-1.5 min-h-11 px-3 bg-teal-50 text-teal-600 hover:bg-teal-500 hover:text-white rounded-xl transition-all border border-teal-100 hover:border-teal-500 shadow-sm cursor-pointer text-base font-bold"
              >
                <Check className="w-5 h-5" strokeWidth={2.5} /> Confirmar
              </button>
            )}
            {awaitingAction && !doctorOnlyMode && (
              <>
                <button
                  type="button"
                  onClick={() => handleApprove(row.id)}
                  className={`flex items-center justify-center w-11 h-11 bg-teal-50 text-teal-600 hover:bg-teal-500 hover:text-white rounded-xl transition-all border border-teal-100 hover:border-teal-500 shadow-sm cursor-pointer ${PHONE_LABELED_BUTTON}`}
                  title="Aprobar"
                  aria-label="Aprobar"
                >
                  <Check className="w-5 h-5" strokeWidth={2.5} />
                  <span className={PHONE_ONLY_LABEL}>Aprobar</span>
                </button>
                <button
                  type="button"
                  onClick={() => openRescheduleModal(row)}
                  className={`flex items-center justify-center w-11 h-11 bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white rounded-xl transition-all border border-amber-100 hover:border-amber-500 shadow-sm cursor-pointer ${TOUCH_LABELED_BUTTON}`}
                  title="Sugerir horario"
                  aria-label="Sugerir horario"
                >
                  <CalendarClock className="w-5 h-5" strokeWidth={2.5} />
                  <span className={TOUCH_ONLY_LABEL}>Sugerir</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRejectModalData(row)}
                  className={`flex items-center justify-center w-11 h-11 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white rounded-xl transition-all border border-red-100 hover:border-red-500 shadow-sm cursor-pointer ${TOUCH_LABELED_BUTTON}`}
                  title="Rechazar Solicitud"
                  aria-label="Rechazar Solicitud"
                >
                  <X className="w-5 h-5" strokeWidth={2.5} />
                  <span className={TOUCH_ONLY_LABEL}>Rechazar</span>
                </button>
              </>
            )}
            {(row.status === "confirmed" ||
              overdue ||
              (row.status === "pending" && doctorOnlyMode)) && (
              <>
                <button
                  type="button"
                  onClick={() => openRescheduleModal(row)}
                  className={`flex items-center justify-center w-11 h-11 bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white rounded-xl transition-all border border-blue-100 hover:border-blue-500 shadow-sm cursor-pointer ${TOUCH_LABELED_BUTTON}`}
                  title="Reprogramar"
                  aria-label="Reprogramar"
                >
                  <CalendarClock className="w-5 h-5" strokeWidth={2.5} />
                  <span className={TOUCH_ONLY_LABEL}>Reprogramar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCancelModalData(row);
                    setCancelReason("");
                  }}
                  className={`flex items-center justify-center w-11 h-11 bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white rounded-xl transition-all border border-rose-100 hover:border-rose-500 shadow-sm cursor-pointer ${TOUCH_LABELED_BUTTON}`}
                  title="Cancelar Cita"
                  aria-label="Cancelar Cita"
                >
                  <CalendarX2 className="w-5 h-5" strokeWidth={2.5} />
                  <span className={TOUCH_ONLY_LABEL}>Cancelar</span>
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
        );
      },
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-md:gap-3 xl:gap-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 max-md:p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2">
          <div className="w-14 h-14 max-md:w-10 max-md:h-10 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <Inbox className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm max-md:text-xs font-bold text-brand-gray uppercase tracking-wider mb-1">
              {doctorOnlyMode ? "Sin confirmar" : "Por Revisar"}
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.pending}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 max-md:p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2">
          <div className="w-14 h-14 max-md:w-10 max-md:h-10 bg-teal-50 text-teal-500 rounded-2xl flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm max-md:text-xs font-bold text-brand-gray uppercase tracking-wider mb-1">
              Confirmadas
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.confirmed}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 max-md:p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2">
          <div className="w-14 h-14 max-md:w-10 max-md:h-10 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center shrink-0">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm max-md:text-xs font-bold text-brand-gray uppercase tracking-wider mb-1">
              Nuevos Pac.
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.newPatients}
            </h4>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-6 max-md:p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2">
          <div className="w-14 h-14 max-md:w-10 max-md:h-10 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <TrendingUp className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm max-md:text-xs font-bold text-brand-gray uppercase tracking-wider mb-1">
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
          <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
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
            <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
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
          rescheduleData?.status === "pending" &&
          !doctorOnlyMode &&
          !hasAppointmentStarted(rescheduleData, now)
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
                    minDate={nowInClinic(new Date(now)).isoDate}
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
            <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
              <Button
                variant="outline"
                onClick={() => setRescheduleData(null)}
                className="flex-1 py-3 rounded-xl cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmReschedule}
                disabled={!isNewTimeBookable || isSubmitting}
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
            <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
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
