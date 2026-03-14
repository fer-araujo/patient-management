import { useState } from "react";
import { Inbox, CalendarDays, FileText } from "lucide-react";
import { InboxTab } from "../components/tabs/InboxTab";
import { PatientsTab } from "../components/tabs/PatientsTab";
import { CalendarTab } from "./tabs/CalendarTab";
// import { CalendarTab } from "./tabs/CalendarTab"; // Lo crearemos después

export const DoctorDashboard = () => {
  const [activeTab, setActiveTab] = useState<"inbox" | "patients" | "calendar">(
    "inbox",
  );

  return (
    <main className="max-w-360 mx-auto px-4 sm:px-6 lg:px-8 pt-8 xl:pt-10 pb-20">
      {/* ========================================================
          HEADER Y NAVEGACIÓN FULL WIDTH
          ======================================================== */}
      <div className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-3xl xl:text-4xl font-extrabold text-brand-dark tracking-tight mb-6">
          Centro de Comando
        </h1>

        {/* TABS ELEGANTES Y MODERNAS */}
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto hide-scrollbar">
          <button
            onClick={() => setActiveTab("inbox")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "inbox"
                ? "bg-brand-primary text-white shadow-md" // <-- CAMBIO AQUÍ
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <Inbox className="w-4 h-4" /> Solicitudes y Citas
          </button>

          <button
            onClick={() => setActiveTab("patients")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "patients"
                ? "bg-brand-primary text-white shadow-md" // <-- CAMBIO AQUÍ
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <FileText className="w-4 h-4" /> Directorio de Pacientes
          </button>

          <button
            onClick={() => setActiveTab("calendar")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "calendar"
                ? "bg-brand-primary text-white shadow-md" // <-- CAMBIO AQUÍ
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <CalendarDays className="w-4 h-4" /> Mi Agenda
          </button>
        </div>
      </div>

      {/* ========================================================
          CONTENIDO DE LAS TABS
          ======================================================== */}
      <div className="mt-6">
        {activeTab === "inbox" && <InboxTab />}
        {activeTab === "patients" && <PatientsTab />}
        {activeTab === "calendar" && <CalendarTab />}
      </div>
    </main>
  );
};
