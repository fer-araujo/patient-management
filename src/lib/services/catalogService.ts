import { supabase } from "../supabase";

export interface ClinicService {
  id: string; // Es un UUID ahora
  name: string;
  category: string;
  description: string;
  durationMins: number;
  price: number | null;
  careGuide: string;
  isActive: boolean; // AÑADIDO: Para controlar el Soft Delete en el panel de la doctora
  /** Supplies the service uses (staff catalog only; absent in the public list). */
  supplies?: ServiceSupply[];
}

/** One line of "Insumos que usa": an inventory item and how many units. */
export interface ServiceSupply {
  itemId: string;
  quantity: number;
  itemName: string;
  unit: string;
}

/** What is sent to the server for a supply: never a cost (migration 22). */
export interface SupplyQuantity {
  itemId: string;
  quantity: number;
}

// Usaremos esto para el formulario de crear/editar (excluimos id, estado e insumos)
export type ServiceFormData = Omit<ClinicService, "id" | "isActive" | "supplies">;

interface RawServiceSupply {
  item_id: string;
  quantity: number;
  inventory: { name: string | null; unit_measure: string | null } | null;
}

const toServiceSupply = (row: RawServiceSupply): ServiceSupply => ({
  itemId: row.item_id,
  quantity: Number(row.quantity),
  itemName: row.inventory?.name || "Artículo",
  unit: row.inventory?.unit_measure || "",
});

const byItemName = (a: ServiceSupply, b: ServiceSupply) =>
  a.itemName.localeCompare(b.itemName, "es");

/** "1 Sculptra · 2 Jeringas", or "—" when the service uses no supplies. */
export const formatSupplies = (supplies: ServiceSupply[] | undefined): string =>
  supplies && supplies.length > 0
    ? supplies.map((s) => `${s.quantity} ${s.itemName}`).join(" · ")
    : "—";

const SUPPLY_COLUMNS = "item_id, quantity, inventory ( name, unit_measure )";

/** Failures raised on purpose by the RPCs carry code P0001 and a Spanish message. */
const rpcError = (error: { code?: string; message: string }, fallback: string) =>
  new Error(error.code === "P0001" ? error.message : fallback);

// ============================================================================
// 1. FUNCIONES PÚBLICAS (Para el Portal del Paciente)
// ============================================================================

export const fetchActiveServices = async (): Promise<ClinicService[]> => {
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching active services:", error);
    throw new Error("No se pudieron cargar los servicios de la clínica.");
  }

  return data.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category || "Tratamiento",
    description: item.description || "",
    durationMins: item.duration_mins,
    price: item.price,
    careGuide:
      item.care_guide ||
      "Siga las instrucciones generales proporcionadas por la doctora en consulta.",
    isActive: item.is_active,
  }));
};

// ============================================================================
// 2. FUNCIONES DE ADMINISTRADOR (Para el Dashboard de la Doctora)
// ============================================================================

export const fetchAllServices = async (): Promise<ClinicService[]> => {
  const { data, error } = await supabase
    .from("services")
    .select(`*, service_supplies ( ${SUPPLY_COLUMNS} )`)
    // Ordenamos primero los activos, y luego alfabéticamente
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching all services:", error);
    throw new Error("No se pudieron cargar los servicios del catálogo.");
  }

  return data.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category || "Tratamiento",
    description: item.description || "",
    durationMins: item.duration_mins,
    price: item.price,
    careGuide: item.care_guide || "",
    isActive: item.is_active,
    supplies: ((item.service_supplies ?? []) as RawServiceSupply[])
      .map(toServiceSupply)
      .sort(byItemName),
  }));
};

/** Creates the service and returns its id. */
export const createService = async (
  serviceData: ServiceFormData,
): Promise<string> => {
  const { data, error } = await supabase.from("services").insert({
    name: serviceData.name,
    category: serviceData.category,
    description: serviceData.description,
    duration_mins: serviceData.durationMins, // Traducción camelCase -> snake_case
    price: serviceData.price,
    care_guide: serviceData.careGuide,
    is_active: true, // Los servicios nuevos nacen activos por defecto
  })
    .select("id")
    .single();

  if (error || !data) {
    console.error("Error creating service:", error);
    throw new Error("Hubo un error al crear el nuevo tratamiento.");
  }
  return (data as { id: string }).id;
};

export const updateService = async (
  id: string,
  serviceData: ServiceFormData,
): Promise<void> => {
  const { error } = await supabase
    .from("services")
    .update({
      name: serviceData.name,
      category: serviceData.category,
      description: serviceData.description,
      duration_mins: serviceData.durationMins, // Traducción camelCase -> snake_case
      price: serviceData.price,
      care_guide: serviceData.careGuide,
    })
    .eq("id", id);

  if (error) {
    console.error("Error updating service:", error);
    throw new Error("Hubo un error al actualizar el tratamiento.");
  }
};

export const toggleServiceStatus = async (
  id: string,
  currentStatus: boolean,
): Promise<void> => {
  const { error } = await supabase
    .from("services")
    .update({ is_active: !currentStatus })
    .eq("id", id);

  if (error) {
    console.error("Error toggling service status:", error);
    throw new Error("No se pudo cambiar el estado del servicio.");
  }
};

/** Supplies of one service, e.g. to pre-fill "Insumos usados" at checkout. */
export const fetchServiceSupplies = async (
  serviceId: string,
): Promise<ServiceSupply[]> => {
  const { data, error } = await supabase
    .from("service_supplies")
    .select(SUPPLY_COLUMNS)
    .eq("service_id", serviceId)
    .returns<RawServiceSupply[]>();

  if (error) {
    console.error("Error fetching service supplies:", error);
    throw new Error("No se pudieron cargar los insumos del tratamiento.");
  }
  return (data ?? []).map(toServiceSupply).sort(byItemName);
};

/**
 * Replaces the supplies of a service in one call (set_service_supplies,
 * migration 22). Unchanged lines are left as they are on the server.
 */
export const setServiceSupplies = async (
  serviceId: string,
  supplies: SupplyQuantity[],
): Promise<void> => {
  for (const s of supplies) {
    if (!Number.isInteger(s.quantity) || s.quantity < 1) {
      throw new Error("La cantidad de cada insumo debe ser 1 o más.");
    }
  }

  const { error } = await supabase.rpc("set_service_supplies", {
    p_service_id: serviceId,
    p_supplies: supplies.map((s) => ({ item_id: s.itemId, quantity: s.quantity })),
  });

  if (error) {
    console.error("[catalogService] set_service_supplies failed:", error.code);
    throw rpcError(error, "No se pudieron guardar los insumos del tratamiento.");
  }
};
