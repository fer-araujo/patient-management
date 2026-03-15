import { useState } from "react";
import { Inbox, CalendarDays, FileText } from "lucide-react";
import { InboxTab } from "./tabs/InboxTab";
import { PatientsTab } from "./tabs/PatientsTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { ConsultationWorkspace } from "./ConsultationWorkspace"; // <-- NUEVO IMPORT
import { type AppointmentData } from "../../../data/mockPatients";

export const DoctorDashboard = () => {
  const [activeTab, setActiveTab] = useState<"inbox" | "patients" | "calendar">(
    "inbox",
  );

  // NUEVO ESTADO: Si hay una cita aquí, entramos a Modo Enfoque
  const [activeConsultation, setActiveConsultation] =
    useState<AppointmentData | null>(null);

  // Funciones puente para Iniciar y Finalizar
  const handleStartConsultation = (appointment: AppointmentData) => {
    setActiveConsultation(appointment);
  };

  const handleFinishConsultation = (id: string) => {
    alert(`¡Consulta ${id} finalizada y guardada en BD!`);
    setActiveConsultation(null); // Salimos del modo enfoque
  };

  // SI HAY UNA CONSULTA ACTIVA, OCULTAMOS EL DASHBOARD Y MOSTRAMOS EL WORKSPACE
  if (activeConsultation) {
    return (
      <ConsultationWorkspace
        appointment={activeConsultation}
        onClose={() => setActiveConsultation(null)}
        onFinishConsultation={handleFinishConsultation}
      />
    );
  }

  // SI NO HAY CONSULTA, MOSTRAMOS EL DASHBOARD NORMAL
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

      {/* CONTENIDO DE LAS TABS (Pasamos el handler a CalendarTab) */}
      <div className="mt-6">
        {activeTab === "inbox" && <InboxTab />}
        {activeTab === "patients" && <PatientsTab />}

        {/* Le pasamos la nueva super-función al calendario */}
        {activeTab === "calendar" && (
          <CalendarTab
            onStartConsultation={handleStartConsultation}
          />
        )}
      </div>
    </main>
  );
};
