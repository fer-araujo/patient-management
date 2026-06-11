import { supabase } from "../supabase";

export interface ClinicService {
  id: string; // Es un UUID ahora
  name: string;
  category: string;
  description: string;
  durationMins: number;
  price: number | null;
  careGuide: string;
}

export const fetchActiveServices = async (): Promise<ClinicService[]> => {
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching services:", error);
    throw new Error("No se pudieron cargar los servicios de la clínica.");
  }

  return data.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category || "Tratamiento",
    description: item.description || "",
    durationMins: item.duration_mins,
    price: item.price,
    careGuide: item.care_guide || "Siga las instrucciones generales proporcionadas por la doctora en consulta.",
  }));
};
