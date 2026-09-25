import { supabase } from "../supabase";

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
  min_alert_level: number;
  unit_measure: string;
  last_restock_date: string;
  is_active: boolean;
}

export type InventoryFormData = Omit<
  InventoryItem,
  "id" | "is_active" | "last_restock_date"
>;

/** Editable item fields. Stock is never written directly: see adjustStock. */
export type InventoryDetails = Omit<InventoryFormData, "stock_quantity">;

export type MovementType = "purchase" | "use" | "adjustment";

export interface InventoryMovement {
  id: string;
  item_id: string;
  type: MovementType;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * Stock level shared by the table, the counters and the dashboard badge:
 * 0 = out of stock, 1..min_alert_level = low, above = ok.
 */
export type StockLevel = "out" | "low" | "ok";

export const getStockLevel = (
  item: Pick<InventoryItem, "stock_quantity" | "min_alert_level">,
): StockLevel => {
  if (item.stock_quantity <= 0) return "out";
  if (item.stock_quantity <= item.min_alert_level) return "low";
  return "ok";
};

/** Active items that need attention (out of stock or low). */
export const countItemsNeedingRestock = (items: InventoryItem[]): number =>
  items.filter((i) => i.is_active && getStockLevel(i) !== "ok").length;

/** Cost per unit rounded to cents, the same way adjust_stock stores it. */
export const computeUnitCost = (
  totalCost: number,
  quantity: number,
): number | null => {
  if (!Number.isFinite(totalCost) || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  return Math.round((totalCost / quantity) * 100) / 100;
};

const mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export const formatMXN = (amount: number): string => mxnFormatter.format(amount);

/** Failures raised on purpose by adjust_stock carry code P0001 and a Spanish message. */
const rpcError = (error: { code?: string; message: string }, fallback: string) =>
  new Error(error.code === "P0001" ? error.message : fallback);

export const fetchInventory = async (): Promise<InventoryItem[]> => {
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching inventory:", error);
    throw new Error("No se pudo cargar el inventario.");
  }
  return data || [];
};

/**
 * Creates an item. Its initial stock is recorded by the database as an
 * "Inventario inicial" movement (migration 16).
 */
/** Creates the item and returns its id (null if the server returned no row). */
export const createInventoryItem = async (
  itemData: InventoryFormData,
): Promise<string | null> => {
  const { data, error } = await supabase
    .from("inventory")
    .insert({
      name: itemData.name,
      category: itemData.category,
      stock_quantity: itemData.stock_quantity,
      min_alert_level: itemData.min_alert_level,
      unit_measure: itemData.unit_measure,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) throw new Error("Error al crear el artículo en el inventario.");
  return (data as { id: string } | null)?.id ?? null;
};

/** Updates the descriptive fields only; stock goes through adjustStock. */
export const updateInventoryItem = async (
  id: string,
  itemData: InventoryDetails,
): Promise<void> => {
  const { error } = await supabase
    .from("inventory")
    .update({
      name: itemData.name,
      category: itemData.category,
      min_alert_level: itemData.min_alert_level,
      unit_measure: itemData.unit_measure,
    })
    .eq("id", id);

  if (error) throw new Error("Error al actualizar el artículo.");
};

/**
 * Applies a signed stock change on the server (adjust_stock RPC) and records
 * it in the movement ledger. The database adds the delta to the CURRENT stock,
 * so quick clicks or two open tabs never overwrite each other.
 * Returns the new stock.
 */
export const adjustStock = async (
  itemId: string,
  delta: number,
  type: MovementType,
  totalCost?: number,
  note?: string,
): Promise<number> => {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error("La cantidad debe ser un número entero distinto de cero.");
  }

  const { data, error } = await supabase.rpc("adjust_stock", {
    p_item_id: itemId,
    p_delta: delta,
    p_type: type,
    p_total_cost: totalCost ?? null,
    p_note: note?.trim() || null,
  });

  if (error) {
    console.error("[InventoryService] adjust_stock failed:", error.code);
    throw rpcError(error, "No se pudo actualizar la cantidad.");
  }
  return data as number;
};

/** Records a purchase: adds units, stores its cost and stamps the restock date. */
export const registerPurchase = async (
  itemId: string,
  quantity: number,
  totalCost: number,
  note?: string,
): Promise<number> => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Indica cuántas unidades compraste (1 o más).");
  }
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    throw new Error("Indica cuánto pagaste en total (0 o más).");
  }
  return adjustStock(itemId, quantity, "purchase", totalCost, note);
};

/** Latest movements of one item, newest first. */
export const fetchMovements = async (
  itemId: string,
): Promise<InventoryMovement[]> => {
  const { data, error } = await supabase
    .from("inventory_movements")
    .select("*")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error fetching inventory movements:", error);
    throw new Error("No se pudo cargar el historial.");
  }
  return data || [];
};

export const toggleInventoryStatus = async (
  id: string,
  currentStatus: boolean,
): Promise<void> => {
  const { error } = await supabase
    .from("inventory")
    .update({ is_active: !currentStatus })
    .eq("id", id);

  if (error) throw new Error("No se pudo cambiar el estado del artículo.");
};
