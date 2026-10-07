import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Minus,
  Edit2,
  Loader2,
  Power,
  Search,
  AlertTriangle,
  Package,
  PackageX,
  ShoppingCart,
  History,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  adjustStock,
  fetchInventory,
  getStockLevel,
  toggleInventoryStatus,
  type InventoryItem,
} from "../../../../lib/services/inventoryService";
import { InventoryModal } from "../modals/InventoryModal";
import { Dropdown } from "../../../../components/ui/Dropdown";
import type { PurchaseModalMode } from "../modals/PurchaseModal";
import { PurchaseModal } from "../modals/PurchaseModal";
import { MovementHistoryModal } from "../modals/MovementHistoryModal";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import {
  TOUCH_ICON_BUTTON,
  TOUCH_LABELED_BUTTON,
  TOUCH_ONLY_LABEL,
  PHONE_LABELED_BUTTON,
  PHONE_ONLY_LABEL,
} from "../../../../components/ui/touchTargets";
import { Button } from "../../../../components/ui/Button";
import { motion } from "framer-motion";

type StatusFilter = "active" | "archived" | "all";

interface Props {
  /** Reports the loaded items, e.g. for the low-stock badge on the tab. */
  onItemsChange?: (items: InventoryItem[]) => void;
}

export const InventoryTab = ({ onItemsChange }: Props = {}) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<InventoryItem | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<{
    item: InventoryItem;
    mode: PurchaseModalMode;
  } | null>(null);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await fetchInventory();
      setItems(data);
    } catch (error: unknown) {
      console.error("[InventoryTab] Error al cargar el inventario:", error);
      toast.error("Error al cargar el inventario");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!isLoading) onItemsChange?.(items);
  }, [items, isLoading, onItemsChange]);

  const handleToggleStatus = async (item: InventoryItem) => {
    try {
      setItems(
        items.map((i) =>
          i.id === item.id ? { ...i, is_active: !i.is_active } : i,
        ),
      );
      await toggleInventoryStatus(item.id, item.is_active);
      toast.success(
        item.is_active ? "Artículo archivado" : "Artículo activado",
      );
    } catch (error: unknown) {
      console.error(
        "[InventoryTab] Error al cambiar estado del artículo:",
        error,
      );
      toast.error("No se pudo cambiar el estado");
      loadData();
    }
  };

  const applyStockDelta = (itemId: string, delta: number) =>
    setItems((current) =>
      current.map((i) =>
        i.id === itemId
          ? { ...i, stock_quantity: i.stock_quantity + delta }
          : i,
      ),
    );

  // Optimistic "−": one unit used. The UI moves at once and the server
  // subtracts from its current stock, so quick clicks never overwrite each
  // other. Increases never go through here: "+" opens the modal, which asks
  // whether the units were bought so their cost reaches Finanzas.
  const handleStockUse = async (item: InventoryItem) => {
    if (item.stock_quantity - 1 < 0) return; // Stock cannot go negative

    applyStockDelta(item.id, -1);

    try {
      await adjustStock(item.id, -1, "use");
    } catch (error: unknown) {
      console.error("[InventoryTab] Error al actualizar el stock:", error);
      // Undo only this click, keeping any other click that did succeed.
      applyStockDelta(item.id, 1);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error de conexión. No se guardó el stock.",
      );
    }
  };

  const handlePurchaseSaved = (itemId: string, newStock: number) =>
    setItems((current) =>
      current.map((i) =>
        i.id === itemId ? { ...i, stock_quantity: newStock } : i,
      ),
    );

  const openNewModal = () => {
    setItemToEdit(null);
    setIsModalOpen(true);
  };

  // ESTADÍSTICAS RÁPIDAS
  const stats = useMemo(() => {
    const activeItems = items.filter((i) => i.is_active);
    return {
      total: activeItems.length,
      lowStock: activeItems.filter((i) => getStockLevel(i) === "low").length,
      outOfStock: activeItems.filter((i) => getStockLevel(i) === "out").length,
    };
  }, [items]);

  const categories = useMemo(
    () =>
      [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    [items],
  );

  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return items.filter(
      (item) =>
        (statusFilter === "all" ||
          (statusFilter === "active" ? item.is_active : !item.is_active)) &&
        (categoryFilter === "" || item.category === categoryFilter) &&
        ((item.name ?? "").toLowerCase().includes(term) ||
          (item.category ?? "").toLowerCase().includes(term)),
    );
  }, [items, searchTerm, statusFilter, categoryFilter]);

  // CONFIGURACIÓN DE COLUMNAS
  const columns: ColumnDef<InventoryItem>[] = [
    {
      header: "Insumo / Producto",
      mobileRole: "title",
      accessorKey: "name",
      sortable: true,
      className: "w-[35%]",
      cell: (row) => (
        <div
          className={`flex flex-col items-start ${!row.is_active && "opacity-50"}`}
        >
          <span
            className={`font-bold text-sm ${row.is_active ? "text-brand-dark" : "text-brand-gray line-through"}`}
          >
            {row.name}
          </span>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md mt-1 uppercase tracking-wider">
            {row.category}
          </span>
        </div>
      ),
    },
    {
      header: "Stock Actual",
      mobileRole: "status",
      accessorKey: "stock_quantity",
      sortable: true,
      className: "w-[25%]",
      cell: (row) => {
        const level = getStockLevel(row);
        const isOutOfStock = level === "out";
        const isLowStock = level === "low";

        let badgeColor = "text-brand-dark";
        let bgColor = "bg-transparent";

        if (isOutOfStock) {
          badgeColor = "text-rose-600 font-extrabold";
          bgColor =
            "bg-rose-50 px-3 py-1 rounded-lg border border-rose-100 inline-flex items-center gap-1.5";
        } else if (isLowStock) {
          badgeColor = "text-amber-600 font-extrabold";
          bgColor =
            "bg-amber-50 px-3 py-1 rounded-lg border border-amber-100 inline-flex items-center gap-1.5";
        } else {
          badgeColor = "text-brand-dark font-bold";
        }

        return (
          <div
            className={`${bgColor} ${!row.is_active && "opacity-50"}`}
            title={
              isOutOfStock ? "Agotado" : isLowStock ? "Stock bajo" : undefined
            }
          >
            {(isOutOfStock || isLowStock) && (
              <AlertTriangle className={`w-4 h-4 ${badgeColor}`} />
            )}
            <span className={`text-sm ${badgeColor}`}>
              {row.stock_quantity}{" "}
              <span className="font-normal text-xs uppercase opacity-70 ml-0.5">
                {row.unit_measure}
              </span>
            </span>
          </div>
        );
      },
    },
    {
      header: "Ajuste Rápido",
      mobileRole: "meta",
      className: "w-[20%]",
      cell: (row) => (
        <div
          className={`flex items-center gap-1 pointer-coarse:gap-3 ${!row.is_active && "opacity-50 pointer-events-none"}`}
        >
          <button
            onClick={() => handleStockUse(row)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-100 transition-colors border border-slate-200 shadow-sm cursor-pointer pointer-coarse:w-11 pointer-coarse:h-11"
            title="Restar unidad (uso)"
            aria-label="Restar unidad (uso)"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPurchaseTarget({ item: row, mode: "add" })}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-teal-50 hover:text-teal-600 hover:border-teal-100 transition-colors border border-slate-200 shadow-sm cursor-pointer pointer-coarse:w-11 pointer-coarse:h-11"
            title="Agregar unidades"
            aria-label="Agregar unidades"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      ),
    },
    {
      header: "Acciones",
      mobileRole: "actions",
      className: "w-[20%] text-right",
      stickyRight: true,
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          {row.is_active && (
            <button
              onClick={() => setPurchaseTarget({ item: row, mode: "purchase" })}
              className={`flex items-center justify-center w-10 h-10 bg-slate-50 text-slate-600 hover:bg-brand-primary hover:text-white rounded-xl transition-all border border-slate-200 hover:border-brand-primary shadow-sm cursor-pointer ${TOUCH_ICON_BUTTON} ${PHONE_LABELED_BUTTON}`}
              title="Registrar compra"
              aria-label="Registrar compra"
            >
              <ShoppingCart className="w-5 h-5" strokeWidth={2.5} />
              <span className={PHONE_ONLY_LABEL}>Comprar</span>
            </button>
          )}
          <button
            onClick={() => setHistoryItem(row)}
            className={`flex items-center justify-center w-10 h-10 bg-slate-50 text-slate-600 hover:bg-brand-primary hover:text-white rounded-xl transition-all border border-slate-200 hover:border-brand-primary shadow-sm cursor-pointer ${TOUCH_ICON_BUTTON} ${PHONE_LABELED_BUTTON}`}
            title="Historial"
            aria-label="Historial"
          >
            <History className="w-5 h-5" strokeWidth={2.5} />
            <span className={PHONE_ONLY_LABEL}>Historial</span>
          </button>
          <button
            onClick={() => {
              setItemToEdit(row);
              setIsModalOpen(true);
            }}
            className={`flex items-center justify-center w-10 h-10 bg-slate-50 text-slate-600 hover:bg-brand-primary hover:text-white rounded-xl transition-all border border-slate-200 hover:border-brand-primary shadow-sm cursor-pointer ${TOUCH_ICON_BUTTON} ${PHONE_LABELED_BUTTON}`}
            title="Editar Insumo"
            aria-label="Editar Insumo"
          >
            <Edit2 className="w-5 h-5" strokeWidth={2.5} />
            <span className={PHONE_ONLY_LABEL}>Editar</span>
          </button>
          <button
            onClick={() => handleToggleStatus(row)}
            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all border shadow-sm cursor-pointer ${TOUCH_LABELED_BUTTON} ${
              row.is_active
                ? "bg-rose-50 text-rose-500 border-rose-100 hover:bg-rose-500 hover:text-white hover:border-rose-500"
                : "bg-teal-50 text-teal-600 border-teal-100 hover:bg-teal-500 hover:text-white hover:border-teal-500"
            }`}
            title={row.is_active ? "Archivar" : "Reactivar"}
            aria-label={row.is_active ? "Archivar" : "Reactivar"}
          >
            <Power className="w-5 h-5" strokeWidth={2.5} />
            <span className={TOUCH_ONLY_LABEL}>
              {row.is_active ? "Archivar" : "Reactivar"}
            </span>
          </button>
        </div>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
        <p className="text-brand-gray font-medium">
          Sincronizando inventario...
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* TARJETAS DE ESTADÍSTICAS (CRÍTICAS PARA INVENTARIO) */}
      <div className="grid grid-cols-3 gap-4 max-md:gap-2 xl:gap-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 max-md:p-3 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2 min-w-0">
          <div className="w-14 h-14 max-md:w-10 max-md:h-10 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <Package className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm max-md:text-[11px] max-md:leading-tight max-md:tracking-normal font-bold text-brand-gray uppercase tracking-wider mb-1">
              Total Insumos
            </p>
            <h4 className="text-3xl max-md:text-2xl font-black text-brand-dark leading-none">
              {stats.total}
            </h4>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 max-md:p-3 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2 min-w-0">
          <div className="w-14 h-14 max-md:w-10 max-md:h-10 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm max-md:text-[11px] max-md:leading-tight max-md:tracking-normal font-bold text-brand-gray uppercase tracking-wider mb-1">
              Stock Bajo
            </p>
            <h4 className="text-3xl max-md:text-2xl font-black text-brand-dark leading-none">
              {stats.lowStock}
            </h4>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 max-md:p-3 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2 min-w-0">
          <div className="w-14 h-14 max-md:w-10 max-md:h-10 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center shrink-0">
            <PackageX className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm max-md:text-[11px] max-md:leading-tight max-md:tracking-normal font-bold text-brand-gray uppercase tracking-wider mb-1">
              Agotados
            </p>
            <h4 className="text-3xl max-md:text-2xl font-black text-brand-dark leading-none">
              {stats.outOfStock}
            </h4>
          </div>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y BOTÓN AÑADIR */}
      {/* Below xl (iPad) the search takes its own row and the filters wrap
          under it; from xl everything sits on one row as before. */}
      <div className="flex flex-col sm:flex-row sm:items-start xl:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap xl:flex-nowrap items-center gap-4 w-full sm:w-auto sm:flex-1 xl:flex-initial">
          <div className="relative w-full xl:w-96">
            <Search className="w-5 h-5 text-brand-gray absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar insumo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 shadow-[0_2px_10px_rgb(0,0,0,0.02)] rounded-xl text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all"
            />
          </div>
          <Dropdown
            className="w-full sm:w-40"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={[
              { label: "Todos", value: "all" },
              { label: "Activos", value: "active" },
              { label: "Archivados", value: "archived" },
            ]}
          />
          <Dropdown
            className="w-full sm:w-56"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { label: "Todas las categorías", value: "" },
              ...categories.map((c) => ({ label: c, value: c })),
            ]}
          />
        </div>
        <Button
          onClick={openNewModal}
          className="px-5 py-2.5 rounded-xl cursor-pointer flex items-center justify-center gap-2 font-bold w-full sm:w-auto shrink-0 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Añadir Artículo
        </Button>
      </div>

      {/* TABLA PRINCIPAL */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <DataGrid
          data={filteredData}
          columns={columns}
          keyExtractor={(row) => row.id}
          itemsPerPage={10}
        />
      </div>

      <InventoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaved={loadData}
        itemToEdit={itemToEdit}
      />

      <PurchaseModal
        // Remounts on every open so the form starts clean (and "+" starts at 1).
        key={
          purchaseTarget
            ? `${purchaseTarget.item.id}-${purchaseTarget.mode}`
            : "closed"
        }
        isOpen={purchaseTarget !== null}
        onClose={() => setPurchaseTarget(null)}
        onSaved={handlePurchaseSaved}
        item={purchaseTarget?.item ?? null}
        mode={purchaseTarget?.mode}
        initialQuantity={purchaseTarget?.mode === "add" ? 1 : undefined}
      />

      <MovementHistoryModal
        isOpen={historyItem !== null}
        onClose={() => setHistoryItem(null)}
        item={historyItem}
      />
    </motion.div>
  );
};
