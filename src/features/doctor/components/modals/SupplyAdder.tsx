import { Dropdown } from "../../../../components/ui/Dropdown";
import type { InventoryItem } from "../../../../lib/services/inventoryService";
import { supplyQuantityInputId } from "./supplyQuantityInput";

interface Props {
  /** Active inventory items, including the ones already listed. */
  items: InventoryItem[];
  /** ids of the items that already have a row. */
  listedIds: string[];
  /** Adds a new row for the item; its quantity is then edited in the row. */
  onAdd: (item: InventoryItem) => void;
  /**
   * id of the visible section title: it names the picker and prefixes the
   * rows' quantity input ids (see `supplyQuantityInputId`).
   */
  labelledBy: string;
}

/**
 * Item picker of a supplies list: picking an item adds it with quantity 1, or
 * focuses its row when it is already listed. Shared by the catalog modal
 * ("Insumos que usa") and the supplies lists ("Insumos usados").
 */
export const SupplyAdder = ({ items, listedIds, onAdd, labelledBy }: Props) => {
  const handlePick = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if (listedIds.includes(itemId)) {
      const input = document.getElementById(
        supplyQuantityInputId(labelledBy, itemId),
      );
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      return;
    }
    onAdd(item);
  };

  if (items.every((i) => listedIds.includes(i.id))) {
    return (
      <p className="text-xs text-brand-gray">
        No hay más artículos activos en el inventario.
      </p>
    );
  }

  return (
    <Dropdown
      options={items.map((i) => ({
        label: listedIds.includes(i.id) ? `${i.name} (ya en la lista)` : i.name,
        value: i.id,
      }))}
      // Always empty: each pick acts right away and leaves the picker ready.
      value=""
      onChange={handlePick}
      placeholder="Elige un artículo para agregarlo..."
      searchable
      labelledBy={labelledBy}
      className="py-0! text-sm!"
    />
  );
};
