import { useEffect, useState } from "react";
import {
  fetchDoctorAppointments,
  type DashboardAppointment,
} from "../../../lib/services/clinicService";
import { Inbox, CalendarDays, FileText, Loader2 } from "lucide-react";
import { InboxTab } from "./tabs/InboxTab";
import { PatientsTab } from "./tabs/PatientsTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import {
  fetchBlockedSlots,
  type DashboardBlockedSlot,
} from "../../../lib/services/blockedSlotsService";
import { CalendarProvider } from "../context/CalendarProvider";

export const DoctorDashboard = () => {
  // 1. ESTADOS PRINCIPALES DE DATOS Y UI
  const [appointments, setAppointments] = useState<DashboardAppointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"inbox" | "patients" | "calendar">(
    "inbox",
  );
  const [activeConsultation, setActiveConsultation] =
    useState<DashboardAppointment | null>(null);
  const [blockedSlots, setBlockedSlots] = useState<DashboardBlockedSlot[]>([]);

  const loadData = async () => {
    try {
      // setIsLoading(true); // Opcional
      const [apptsData, blocksData] = await Promise.all([
        fetchDoctorAppointments(),
        fetchBlockedSlots(),
      ]);
      setAppointments(apptsData);
      setBlockedSlots(blocksData);
    } catch (error) {
      console.error("Error cargando dashboard:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. CARGAR DATOS AL MONTAR EL COMPONENTE
  useEffect(() => {
    loadData();
  }, []);

  // 4. Funciones puente para Iniciar y Finalizar Consulta
  const handleStartConsultation = (appointment: DashboardAppointment) => {
    setActiveConsultation(appointment);
  };

  const handleFinishConsultation = (id: string) => {
    // Pronto cambiaremos este alert por una actualización real en Supabase
    alert(`¡Consulta ${id} finalizada y guardada!`);
    setActiveConsultation(null); // Salimos del modo enfoque
  };

  // =======================================================================
  // RENDERIZADO CONDICIONAL
  // =======================================================================

  // A) SI HAY UNA CONSULTA ACTIVA, OCULTAMOS EL DASHBOARD Y MOSTRAMOS EL WORKSPACE
  if (activeConsultation) {
    return (
      <ConsultationWorkspace
        appointment={activeConsultation}
        onClose={() => setActiveConsultation(null)}
        onFinishConsultation={handleFinishConsultation}
      />
    );
  }

  // B) SI AÚN ESTÁ CARGANDO DATOS DE LA BASE DE DATOS
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

  // C) DASHBOARD PRINCIPAL CARGADO
  return (
    <main className="max-w-360 mx-auto px-4 sm:px-6 lg:px-8 pt-8 xl:pt-10 pb-20">
      {/* HEADER Y NAVEGACIÓN */}
      <div className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-3xl xl:text-4xl font-extrabold text-brand-dark tracking-tight mb-6">
          Centro de Comando
        </h1>

        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto hide-scrollbar">
          <button
            onClick={() => setActiveTab("inbox")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "inbox" ? "bg-brand-primary text-white shadow-md" : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"}`}
          >
            <Inbox className="w-4 h-4" /> Solicitudes y Citas
          </button>
          <button
            onClick={() => setActiveTab("patients")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "patients" ? "bg-brand-primary text-white shadow-md" : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"}`}
          >
            <FileText className="w-4 h-4" /> Directorio de Pacientes
          </button>
          <button
            onClick={() => setActiveTab("calendar")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "calendar" ? "bg-brand-primary text-white shadow-md" : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"}`}
          >
            <CalendarDays className="w-4 h-4" /> Mi Agenda
          </button>
        </div>
      </div>

      {/* CONTENIDO DE LAS TABS */}
      <div className="mt-6">
        <CalendarProvider>
          {/* Le pasamos los datos REALES (appointments) a cada tab */}
          {activeTab === "inbox" && (
            <InboxTab
              appointments={appointments}
              onDataChange={loadData}
              blockedSlots={blockedSlots}
            />
          )}
          {activeTab === "patients" && (
            <PatientsTab appointments={appointments} />
          )}

          {/* Al calendario le pasamos los datos Y la función para iniciar consulta */}
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
