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

export const createInventoryItem = async (
  itemData: InventoryFormData,
): Promise<void> => {
  const { error } = await supabase.from("inventory").insert({
    ...itemData,
    is_active: true,
  });

  if (error) throw new Error("Error al crear el artículo en el inventario.");
};

export const updateInventoryItem = async (
  id: string,
  itemData: InventoryFormData,
): Promise<void> => {
  const { error } = await supabase
    .from("inventory")
    .update({ ...itemData })
    .eq("id", id);

  if (error) throw new Error("Error al actualizar el artículo.");
};

// ⚡ LA FUNCIÓN MÁGICA PARA LOS BOTONES RÁPIDOS (+ / -)
export const updateItemStock = async (
  id: string,
  newStock: number,
): Promise<void> => {
  const { error } = await supabase
    .from("inventory")
    .update({
      stock_quantity: newStock,
      // Si el stock sube, asumimos que hubo un reabastecimiento
      last_restock_date: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error("No se pudo actualizar la cantidad.");
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
