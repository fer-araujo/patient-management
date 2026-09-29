import { useEffect, useState } from "react";
import {
  fetchServiceSupplies,
  type SupplyQuantity,
} from "../../../../lib/services/catalogService";
import {
  fetchInventory,
  type InventoryItem,
} from "../../../../lib/services/inventoryService";

/** A line of "Insumos usados"; the quantity is kept as typed. */
export interface SupplyLine {
  itemId: string;
  quantity: string;
}

interface SupplyState {
  /** Every inventory item, for names, units and current stock. */
  inventory: InventoryItem[];
  lines: SupplyLine[];
  loadFailed: boolean;
}

export type SupplyLineProblem = "invalid" | "over" | null;

/** "" counts as 0 (not used); otherwise a whole number of 0 or more. */
const parseSupplyQuantity = (value: string): number | null => {
  if (value.trim() === "") return 0;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * State of an "Insumos usados" list: pre-filled from the service's supplies
 * (active items only), editable, and checked against the current stock.
 * Loaded once, the first time `enabled` is true, so edits survive closing and
 * reopening. The server re-checks the stock when the list is saved.
 * Shared by the charge step ("Finalizar Consulta") and "Registrar insumos".
 */
export const useSuppliesUsed = ({
  enabled,
  serviceId,
}: {
  enabled: boolean;
  serviceId?: string | null;
}) => {
  const [state, setState] = useState<SupplyState | null>(null);

  const shouldLoad = enabled && state === null;
  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    Promise.all([
      fetchInventory(),
      serviceId ? fetchServiceSupplies(serviceId) : Promise.resolve([]),
    ])
      .then(([inventory, serviceSupplies]) => {
        if (cancelled) return;
        const activeIds = new Set(
          inventory.filter((i) => i.is_active).map((i) => i.id),
        );
        setState({
          inventory,
          // Archived items cannot be used, so they are not pre-filled.
          lines: serviceSupplies
            .filter((s) => activeIds.has(s.itemId))
            .map((s) => ({ itemId: s.itemId, quantity: String(s.quantity) })),
          loadFailed: false,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[useSuppliesUsed] Error al cargar los insumos:", error);
        setState({ inventory: [], lines: [], loadFailed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [shouldLoad, serviceId]);

  const itemsById = new Map((state?.inventory ?? []).map((i) => [i.id, i]));
  const lines = state?.lines ?? [];

  const lineProblem = (line: SupplyLine): SupplyLineProblem => {
    const quantity = parseSupplyQuantity(line.quantity);
    if (quantity === null) return "invalid";
    const stock = itemsById.get(line.itemId)?.stock_quantity ?? 0;
    return quantity > stock ? "over" : null;
  };

  const updateLines = (update: (lines: SupplyLine[]) => SupplyLine[]) =>
    setState((current) =>
      current ? { ...current, lines: update(current.lines) } : current,
    );

  return {
    isLoading: state === null,
    loadFailed: state?.loadFailed ?? false,
    lines,
    itemsById,
    lineProblem,
    /** Loaded, and every quantity is a whole number within the stock. */
    isValid: state !== null && lines.every((l) => lineProblem(l) === null),
    addableItems: (state?.inventory ?? []).filter(
      (i) => i.is_active && !lines.some((l) => l.itemId === i.id),
    ),
    setQuantity: (itemId: string, quantity: string) =>
      updateLines((current) =>
        current.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)),
      ),
    remove: (itemId: string) =>
      updateLines((current) => current.filter((l) => l.itemId !== itemId)),
    add: (item: InventoryItem, quantity: number) =>
      updateLines((current) => [
        ...current,
        { itemId: item.id, quantity: String(quantity) },
      ]),
    /**
     * What to send: the lines above 0 (possibly none). Undefined when the list
     * could not be loaded, i.e. the supplies step was not done.
     */
    toSupplies: (): SupplyQuantity[] | undefined =>
      state === null || state.loadFailed
        ? undefined
        : lines
            .map((l) => ({
              itemId: l.itemId,
              quantity: parseSupplyQuantity(l.quantity) ?? 0,
            }))
            .filter((l) => l.quantity > 0),
  };
};

export type SuppliesUsed = ReturnType<typeof useSuppliesUsed>;
