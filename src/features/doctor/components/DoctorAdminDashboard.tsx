import { useEffect, useState } from "react";
import { Stethoscope, Package, CircleDollarSign } from "lucide-react";
import { CatalogTab } from "./tabs/CatalogTab";
import { InventoryTab } from "./tabs/InventoryTab";
import { FinanceTab } from "./tabs/FinanceTab";
import {
  countItemsNeedingRestock,
  fetchInventory,
  type InventoryItem,
} from "../../../lib/services/inventoryService";
import { isDoctorRole, useAuthRole } from "../../auth/useAuthRole";

export const DoctorAdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<
    "catalog" | "inventory" | "finances"
  >("catalog");
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const restockCount = countItemsNeedingRestock(inventoryItems);
  // Patient names in Finanzas are for the doctor only, never for an admin.
  const { role, loading: roleLoading } = useAuthRole();

  // Loads once for the badge; InventoryTab keeps it current while open.
  useEffect(() => {
    fetchInventory()
      .then(setInventoryItems)
      .catch((error: unknown) =>
        console.error("[DoctorAdminDashboard] Error al cargar el inventario:", error),
      );
  }, []);

  return (
    <main className="max-w-360 mx-auto px-4 sm:px-6 lg:px-8 pt-8 max-md:pt-5 xl:pt-10 pb-20">
      <div className="mb-8 max-md:mb-6 border-b border-slate-200 pb-6 max-md:pb-4">
        <h1 className="text-3xl max-md:text-2xl xl:text-4xl font-extrabold text-brand-dark tracking-tight mb-6 max-md:mb-4">
          Gestión del Negocio
        </h1>

        {/* TABS ADMINISTRATIVOS */}
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 sm:gap-4 overflow-x-auto hide-scrollbar">
          <button
            onClick={() => setActiveTab("catalog")}
            className={`flex items-center gap-2 px-6 max-md:px-4 py-3 max-md:min-h-11 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "catalog"
                ? "bg-brand-dark text-white shadow-md"
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <Stethoscope className="w-4 h-4" /> Catálogo{" "}
            <span className="max-md:hidden">de Servicios</span>
          </button>

          <button
            onClick={() => setActiveTab("inventory")}
            className={`flex items-center gap-2 px-6 max-md:px-4 py-3 max-md:min-h-11 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "inventory"
                ? "bg-brand-dark text-white shadow-md"
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <Package className="w-4 h-4" /> Inventario{" "}
            <span className="max-md:hidden">Clínico</span>
            {restockCount > 0 && (
              <span
                className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md"
                title="Artículos agotados o con stock bajo"
              >
                {restockCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("finances")}
            className={`flex items-center gap-2 px-6 max-md:px-4 py-3 max-md:min-h-11 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "finances"
                ? "bg-brand-dark text-white shadow-md"
                : "bg-slate-100 text-brand-gray hover:bg-slate-200 hover:text-brand-dark"
            }`}
          >
            <CircleDollarSign className="w-4 h-4" /> Finanzas{" "}
            <span className="max-md:hidden">y Métricas</span>
          </button>
        </div>
      </div>

      {/* CONTENEDOR DE VISTAS */}
      <div className="mt-6">
        {activeTab === "catalog" && <CatalogTab />}

        {activeTab === "inventory" && (
          <InventoryTab onItemsChange={setInventoryItems} />
        )}

        {activeTab === "finances" && !roleLoading && (
          <FinanceTab showPatientNames={isDoctorRole(role)} />
        )}
      </div>
    </main>
  );
};
