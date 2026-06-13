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
}

// Usaremos esto para el formulario de crear/editar (excluimos id y estado)
export type ServiceFormData = Omit<ClinicService, "id" | "isActive">;

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
    .select("*")
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
  }));
};

export const createService = async (
  serviceData: ServiceFormData,
): Promise<void> => {
  const { error } = await supabase.from("services").insert({
    name: serviceData.name,
    category: serviceData.category,
    description: serviceData.description,
    duration_mins: serviceData.durationMins, // Traducción camelCase -> snake_case
    price: serviceData.price,
    care_guide: serviceData.careGuide,
    is_active: true, // Los servicios nuevos nacen activos por defecto
  });

  if (error) {
    console.error("Error creating service:", error);
    throw new Error("Hubo un error al crear el nuevo tratamiento.");
  }
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
