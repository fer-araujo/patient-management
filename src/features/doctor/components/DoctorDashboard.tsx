import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  fetchDoctorAppointments,
  updateAppointmentStatus,
  type DashboardAppointment,
} from "../../../lib/services/clinicService";
import {
  Inbox,
  CalendarDays,
  FileText,
  Loader2,
  ShieldCheck,
  History,
} from "lucide-react";
import { InboxTab } from "./tabs/InboxTab";
import { PatientsTab } from "./tabs/PatientsTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { ArcoRequestsTab } from "./tabs/ArcoRequestsTab";
import { AuditLogTab } from "./tabs/AuditLogTab";
import { fetchArcoRequests } from "../../../lib/services/privacyService";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import {
  fetchBlockedSlots,
  type DashboardBlockedSlot,
} from "../../../lib/services/blockedSlotsService";
import { CalendarProvider } from "../context/CalendarProvider";
import { ClinicModeSwitch } from "./ClinicModeSwitch";
import { PrescriberProfileButton } from "../prescription/PrescriberProfileButton";

export const DoctorDashboard = () => {
  const [appointments, setAppointments] = useState<DashboardAppointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "inbox" | "patients" | "calendar" | "arco" | "audit"
  >("inbox");
  // ARCO requests carry a legal deadline, so the pending count is always on
  // the tab. Refreshed on every tab change so resolving one updates it.
  const [pendingArco, setPendingArco] = useState(0);

  useEffect(() => {
    fetchArcoRequests()
      .then((requests) =>
        setPendingArco(
          requests.filter(
            (r) => r.status === "received" || r.status === "in_progress",
          ).length,
        ),
      )
      .catch((error: unknown) =>
        console.error("[DoctorDashboard] Error al cargar solicitudes ARCO:", error),
      );
  }, [activeTab]);
  const [activeConsultation, setActiveConsultation] =
    useState<DashboardAppointment | null>(null);
  const [blockedSlots, setBlockedSlots] = useState<DashboardBlockedSlot[]>([]);

  const loadData = async () => {
    try {
      const [apptsData, blocksData] = await Promise.all([
        fetchDoctorAppointments(),
        fetchBlockedSlots(),
      ]);
      setAppointments(apptsData);
      setBlockedSlots(blocksData);
    } catch (error) {
      console.error("Error cargando dashboard:", error);
      toast.error("Error al sincronizar con el servidor.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleStartConsultation = (appointment: DashboardAppointment) => {
    setActiveConsultation(appointment);
  };

  // FIX FASE A: Lógica real de finalización de cita
  // With `keepOpen` the workspace shows "Consulta finalizada" (to send the
  // prescription) and closes itself through onClose ("Listo").
  const handleFinishConsultation = async (
    id: string,
    options?: { keepOpen: boolean },
  ) => {
    try {
      // 1. Cambiamos el estatus en la BD a "completed"
      await updateAppointmentStatus(id, "completed");

      // 2. Refrescamos los datos globales para que desaparezca del pending/calendario
      await loadData();

      // 3. Mostramos Toast de Éxito
      toast.success("¡Expediente guardado y cita finalizada!");

      // 4. Cerramos el Workspace
      if (!options?.keepOpen) setActiveConsultation(null);
    } catch (error) {
      console.error("Error al completar cita:", error);
      toast.error("No se pudo marcar la cita como completada.");
    }
  };

  if (activeConsultation) {
    return (
      <ConsultationWorkspace
        // One mount per appointment: no editor state leaks between consultations.
        key={activeConsultation.id}
        appointment={activeConsultation}
        onClose={() => setActiveConsultation(null)}
        onFinishConsultation={handleFinishConsultation}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
        <p className="text-brand-gray font-medium">
          Sincronizando expedientes clínicos...
        </p>
      </div>
    );
  }

  return (
    <main className="max-w-360 mx-auto px-4 sm:px-6 lg:px-8 pt-8 max-md:pt-5 xl:pt-10 pb-20">
      <div className="mb-8 max-md:mb-6 border-b border-slate-200 pb-6 max-md:pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4 max-md:gap-3 mb-6 max-md:mb-4">
          <h1 className="text-3xl max-md:text-2xl xl:text-4xl font-extrabold text-brand-dark tracking-tight">
            Centro de Comando
          </h1>
          <div className="flex flex-wrap items-center gap-3 max-md:w-full">
            <PrescriberProfileButton />
            <ClinicModeSwitch />
          </div>
        </div>
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 sm:gap-4 overflow-x-auto hide-scrollbar">
          <button
            onClick={() => setActiveTab("inbox")}
            className={`flex items-center gap-2 px-6 max-md:px-4 py-3 max-md:min-h-11 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "inbox" ? "bg-brand-primary text-white shadow-md" : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"}`}
          >
            <Inbox className="w-4 h-4" /> Agenda
          </button>
          <button
            onClick={() => setActiveTab("patients")}
            className={`flex items-center gap-2 px-6 max-md:px-4 py-3 max-md:min-h-11 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "patients" ? "bg-brand-primary text-white shadow-md" : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"}`}
          >
            <FileText className="w-4 h-4" />{" "}
            <span className="max-md:hidden">Directorio de</span> Pacientes
          </button>
          <button
            onClick={() => setActiveTab("calendar")}
            className={`flex items-center gap-2 px-6 max-md:px-4 py-3 max-md:min-h-11 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "calendar" ? "bg-brand-primary text-white shadow-md" : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"}`}
          >
            <CalendarDays className="w-4 h-4" /> Calendario
          </button>
          <button
            onClick={() => setActiveTab("arco")}
            className={`flex items-center gap-2 px-6 max-md:px-4 py-3 max-md:min-h-11 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "arco" ? "bg-brand-primary text-white shadow-md" : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"}`}
          >
            <ShieldCheck className="w-4 h-4" /> Solicitudes
            {pendingArco > 0 && (
              <span
                className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md"
                title="Solicitudes pendientes de respuesta"
              >
                {pendingArco}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`flex items-center gap-2 px-6 max-md:px-4 py-3 max-md:min-h-11 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "audit" ? "bg-brand-primary text-white shadow-md" : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"}`}
          >
            <History className="w-4 h-4" /> Bitácora
          </button>
        </div>
      </div>

      <div className="mt-6">
        <CalendarProvider>
          {activeTab === "inbox" && (
            <InboxTab
              appointments={appointments}
              onDataChange={loadData}
              blockedSlots={blockedSlots}
            />
          )}
          {activeTab === "patients" && <PatientsTab />}
          {activeTab === "arco" && <ArcoRequestsTab />}
          {activeTab === "audit" && <AuditLogTab />}
          {activeTab === "calendar" && (
            <CalendarTab
              appointments={appointments}
              blockedSlots={blockedSlots}
              onStartConsultation={handleStartConsultation}
              onDataChange={loadData}
            />
          )}
        </CalendarProvider>
      </div>
    </main>
  );
};
