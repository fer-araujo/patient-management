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
} from "lucide-react";
import toast from "react-hot-toast";
import {
  fetchInventory,
  updateItemStock,
  toggleInventoryStatus,
  type InventoryItem,
} from "../../../../lib/services/inventoryService";
import { InventoryModal } from "../modals/InventoryModal";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import { Button } from "../../../../components/ui/Button";
import { motion } from "framer-motion";

export const InventoryTab = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<InventoryItem | null>(null);

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

  // ⚡ OPTIMISTIC UI: Ajuste de stock sin fricción
  const handleStockAdjust = async (item: InventoryItem, adjustment: number) => {
    const newStock = item.stock_quantity + adjustment;
    if (newStock < 0) return; // No puede haber stock negativo

    // 1. Actualizamos la UI inmediatamente (Optimista)
    const previousItems = [...items];
    setItems(
      items.map((i) =>
        i.id === item.id ? { ...i, stock_quantity: newStock } : i,
      ),
    );

    // 2. Guardamos en BD silenciosamente
    try {
      await updateItemStock(item.id, newStock);
    } catch (error: unknown) {
      console.error("[InventoryTab] Error al actualizar el stock:", error);
      // 3. Si falla, revertimos y avisamos
      setItems(previousItems);
      toast.error("Error de conexión. No se guardó el stock.");
    }
  };

  const openNewModal = () => {
    setItemToEdit(null);
    setIsModalOpen(true);
  };

  // ESTADÍSTICAS RÁPIDAS
  const stats = useMemo(() => {
    const activeItems = items.filter((i) => i.is_active);
    return {
      total: activeItems.length,
      lowStock: activeItems.filter(
        (i) => i.stock_quantity <= i.min_alert_level && i.stock_quantity > 0,
      ).length,
      outOfStock: activeItems.filter((i) => i.stock_quantity === 0).length,
    };
  }, [items]);

  const filteredData = useMemo(() => {
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [items, searchTerm]);

  // CONFIGURACIÓN DE COLUMNAS
  const columns: ColumnDef<InventoryItem>[] = [
    {
      header: "Insumo / Producto",
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
      accessorKey: "stock_quantity",
      sortable: true,
      className: "w-[25%]",
      cell: (row) => {
        const isOutOfStock = row.stock_quantity === 0;
        const isLowStock =
          row.stock_quantity <= row.min_alert_level && !isOutOfStock;

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
          <div className={`${bgColor} ${!row.is_active && "opacity-50"}`}>
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
      className: "w-[20%]",
      cell: (row) => (
        <div
          className={`flex items-center gap-1 ${!row.is_active && "opacity-50 pointer-events-none"}`}
        >
          <button
            onClick={() => handleStockAdjust(row, -1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-200 hover:text-brand-dark transition-colors border border-slate-200 shadow-sm cursor-pointer"
            title="Restar unidad"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleStockAdjust(row, 1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-200 hover:text-brand-dark transition-colors border border-slate-200 shadow-sm cursor-pointer"
            title="Sumar unidad"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      ),
    },
    {
      header: "Acciones",
      className: "w-[20%] text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => {
              setItemToEdit(row);
              setIsModalOpen(true);
            }}
            className="flex items-center justify-center w-10 h-10 bg-slate-50 text-slate-600 hover:bg-brand-primary hover:text-white rounded-xl transition-all border border-slate-200 hover:border-brand-primary shadow-sm cursor-pointer"
            title="Editar Insumo"
          >
            <Edit2 className="w-5 h-5" strokeWidth={2.5} />
          </button>
          <button
            onClick={() => handleToggleStatus(row)}
            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all border shadow-sm cursor-pointer ${
              row.is_active
                ? "bg-rose-50 text-rose-500 border-rose-100 hover:bg-rose-500 hover:text-white hover:border-rose-500"
                : "bg-teal-50 text-teal-600 border-teal-100 hover:bg-teal-500 hover:text-white hover:border-teal-500"
            }`}
            title={row.is_active ? "Archivar" : "Reactivar"}
          >
            <Power className="w-5 h-5" strokeWidth={2.5} />
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 xl:gap-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <Package className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Total Insumos
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.total}
            </h4>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Stock Bajo
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.lowStock}
            </h4>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center shrink-0">
            <PackageX className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Agotados
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {stats.outOfStock}
            </h4>
          </div>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y BOTÓN AÑADIR */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="w-5 h-5 text-brand-gray absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar insumo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 shadow-[0_2px_10px_rgb(0,0,0,0.02)] rounded-xl text-sm font-medium focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all"
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
    </motion.div>
  );
};
