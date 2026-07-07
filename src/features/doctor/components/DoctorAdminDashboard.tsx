import { useState } from "react";
import { Stethoscope, Package, CircleDollarSign } from "lucide-react";
import { CatalogTab } from "./tabs/CatalogTab";
import { InventoryTab } from "./tabs/InventoryTab";

export const DoctorAdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<
    "catalog" | "inventory" | "finances"
  >("catalog");

  return (
    <main className="max-w-360 mx-auto px-4 sm:px-6 lg:px-8 pt-8 xl:pt-10 pb-20">
      <div className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-3xl xl:text-4xl font-extrabold text-brand-dark tracking-tight mb-6">
          Gestión del Negocio
        </h1>

        {/* TABS ADMINISTRATIVOS */}
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto hide-scrollbar">
          <button
            onClick={() => setActiveTab("catalog")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "catalog"
                ? "bg-brand-dark text-white shadow-md"
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <Stethoscope className="w-4 h-4" /> Catálogo de Servicios
          </button>

          <button
            onClick={() => setActiveTab("inventory")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "inventory"
                ? "bg-brand-dark text-white shadow-md"
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <Package className="w-4 h-4" /> Inventario Clínico
          </button>

          <button
            onClick={() => setActiveTab("finances")}
            className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "finances"
                ? "bg-brand-dark text-white shadow-md"
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <CircleDollarSign className="w-4 h-4" /> Finanzas y Métricas
          </button>
        </div>
      </div>

      {/* CONTENEDOR DE VISTAS */}
      <div className="mt-6">
        {activeTab === "catalog" && <CatalogTab />}

        {activeTab === "inventory" && <InventoryTab />}

        {activeTab === "finances" && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-brand-gray">
            <h2 className="text-xl font-bold text-brand-dark mb-2">
              Métricas Financieras
            </h2>
            <p>Próximamente...</p>
          </div>
        )}
      </div>
    </main>
  );
};
