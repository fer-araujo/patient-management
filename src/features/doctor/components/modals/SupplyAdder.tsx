import { useState } from "react";
import { Plus } from "lucide-react";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { Button } from "../../../../components/ui/Button";
import type { InventoryItem } from "../../../../lib/services/inventoryService";

/** Same look as the compact inputs of the catalog and charge modals. */
export const supplyQuantityClasses =
  "w-20 px-3 py-2.5 border-2 border-brand-light rounded-lg text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all";

interface Props {
  /** Items that can still be added (active and not listed yet). */
  items: InventoryItem[];
  onAdd: (item: InventoryItem, quantity: number) => void;
  /** id of the visible section title, so the picker has an accessible name. */
  labelledBy: string;
}

/**
 * "Choose an item, type how many, Agregar". Shared by the catalog modal
 * ("Insumos que usa") and the charge step ("Insumos usados").
 */
export const SupplyAdder = ({ items, onAdd, labelledBy }: Props) => {
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");

  const selected = items.find((i) => i.id === itemId) ?? null;
  const parsed = Number(quantity);
  const isValid = selected !== null && Number.isInteger(parsed) && parsed > 0;

  const handleAdd = () => {
    if (!selected || !isValid) return;
    onAdd(selected, parsed);
    setItemId("");
    setQuantity("1");
  };

  if (items.length === 0) {
    return (
      <p className="text-xs text-brand-gray">
        No hay más artículos activos en el inventario.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-40">
        <Dropdown
          options={items.map((i) => ({ label: i.name, value: i.id }))}
          value={itemId}
          onChange={setItemId}
          placeholder="Elige un artículo..."
          searchable
          labelledBy={labelledBy}
          className="py-0! text-sm!"
        />
      </div>
      <input
        type="number"
        min={1}
        step={1}
        aria-label="Cantidad a agregar"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={(e) => {
          // Enter adds the item instead of submitting the whole form.
          if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
          }
        }}
        className={supplyQuantityClasses}
      />
      {selected && (
        <span className="text-xs text-brand-gray">{selected.unit_measure}</span>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        disabled={!isValid}
        className="px-4 py-2.5 cursor-pointer text-sm w-auto! disabled:opacity-50"
      >
        <Plus className="w-4 h-4" /> Agregar
      </Button>
    </div>
  );
};
