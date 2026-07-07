import { useState, useEffect } from "react";
import { Loader2, Save, Package, Edit2 } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../../components/ui/Modal";
import { Input } from "../../../../components/ui/Input";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { Button } from "../../../../components/ui/Button";
import {
  createInventoryItem,
  updateInventoryItem,
  type InventoryItem,
  type InventoryFormData,
} from "../../../../lib/services/inventoryService";

const CATEGORY_OPTIONS = [
  { label: "Desechables Clínicos", value: "Desechables" },
  { label: "Medicación / Toxinas", value: "Medicamentos" },
  { label: "Insumos Quirúrgicos", value: "Insumos" },
  { label: "Productos de Venta", value: "Venta Pública" },
  { label: "Otro", value: "Otro" },
];

const UNIT_OPTIONS = [
  { label: "Piezas (Pzs)", value: "piezas" },
  { label: "Cajas", value: "cajas" },
  { label: "Viales / Ámpulas", value: "viales" },
  { label: "Paquetes", value: "paquetes" },
  { label: "Mililitros (ml)", value: "ml" },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  itemToEdit?: InventoryItem | null;
}

export const InventoryModal = ({
  isOpen,
  onClose,
  onSaved,
  itemToEdit,
}: Props) => {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<InventoryFormData>({
    name: "",
    category: "Desechables",
    stock_quantity: 0,
    min_alert_level: 5,
    unit_measure: "piezas",
  });

  useEffect(() => {
    if (itemToEdit) {
      setFormData({
        name: itemToEdit.name,
        category: itemToEdit.category,
        stock_quantity: itemToEdit.stock_quantity,
        min_alert_level: itemToEdit.min_alert_level,
        unit_measure: itemToEdit.unit_measure,
      });
    } else {
      setFormData({
        name: "",
        category: "Desechables",
        stock_quantity: 0,
        min_alert_level: 5,
        unit_measure: "piezas",
      });
    }
  }, [itemToEdit, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (itemToEdit) {
        await updateInventoryItem(itemToEdit.id, formData);
        toast.success("Artículo actualizado");
      } else {
        await createInventoryItem(formData);
        toast.success("Artículo agregado al inventario");
      }
      onSaved();
      onClose();
    } catch (error: unknown) {
      console.error("[InventoryModal] Error al guardar el artículo:", error);
      toast.error("Ocurrió un error al guardar los datos");
    } finally {
      setIsLoading(false);
    }
  };

  const compactInputClasses = "!py-2.5 !px-3 !text-sm !rounded-lg";
  const compactLabelClasses =
    "[&>label]:!text-sm [&>label]:!font-bold [&>label]:!mb-0.5";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={itemToEdit ? "Editar Artículo" : "Añadir al Inventario"}
      icon={
        itemToEdit ? (
          <Edit2 className="w-5 h-5 text-brand-primary" />
        ) : (
          <Package className="w-5 h-5 text-brand-primary" />
        )
      }
      hideFooter={true}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Nombre del Artículo"
            type="text"
            placeholder="Ej. Jeringas 5ml"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            containerClassName={`w-full ${compactLabelClasses}`}
            className={compactInputClasses}
          />
          <div className="w-full">
            <label className="text-brand-dark font-bold text-sm mb-2 block">
              Categoría
            </label>
            <Dropdown
              options={CATEGORY_OPTIONS}
              value={formData.category}
              onChange={(val) => setFormData({ ...formData, category: val })}
              className="py-0! text-sm!"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="Stock Actual"
            type="number"
            min={0}
            value={formData.stock_quantity.toString()}
            onChange={(e) =>
              setFormData({
                ...formData,
                stock_quantity: parseInt(e.target.value) || 0,
              })
            }
            required
            containerClassName={`w-full ${compactLabelClasses}`}
            className={compactInputClasses}
          />
          <div className="w-full">
            <label className="text-brand-dark font-bold text-sm mb-2 block">
              Unidad de Medida
            </label>
            <Dropdown
              options={UNIT_OPTIONS}
              value={formData.unit_measure}
              onChange={(val) =>
                setFormData({ ...formData, unit_measure: val })
              }
              className="py-0! text-sm!"
            />
          </div>
          <Input
            label="Alerta de Stock Bajo"
            type="number"
            min={0}
            value={formData.min_alert_level.toString()}
            onChange={(e) =>
              setFormData({
                ...formData,
                min_alert_level: parseInt(e.target.value) || 0,
              })
            }
            required
            containerClassName={`w-full ${compactLabelClasses}`}
            className={compactInputClasses}
          />
        </div>
        <p className="text-xs text-brand-gray mt-1 flex items-center">
          * El sistema te alertará en color rojo cuando el stock sea menor o
          igual a tu "Alerta de Stock Bajo".
        </p>

        <div className="pt-4 mt-2 border-t border-brand-light flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="px-6 py-2.5 cursor-pointer text-sm"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="px-6 py-2.5 flex items-center gap-2 cursor-pointer text-sm disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {itemToEdit ? "Guardar Cambios" : "Crear Artículo"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
