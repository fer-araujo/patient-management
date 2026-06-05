import { supabase } from "../supabase";

// INTERFAZ ESTRICTA PARA LA RESPUESTA DE SUPABASE (CERO ANY)
interface RawPatientData {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  dob: string | null;
  gender: string | null;
  blood_type: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  status: "active" | "blocked" | "archived";
  appointments: { start_time: string; status: string }[] | null;
}

export interface DashboardPatient {
  id: string;
  name: string;
  phone: string;
  dob?: string;
  gender?: string;
  bloodType?: string;
  allergies?: string;
  chronicConditions?: string;
  status: "active" | "blocked" | "archived";
  totalVisits: number;
  lastVisit: string | null;
}

export const fetchPatients = async (): Promise<DashboardPatient[]> => {
  const { data, error } = await supabase
    .from("patients")
    .select(
      `
      id,
      first_name,
      last_name,
      phone,
      dob,
      gender,
      blood_type,
      allergies,
      chronic_conditions,
      status,
      appointments (
        start_time,
        status
      )
    `,
    )
    .order("created_at", { ascending: false })
    .returns<RawPatientData[]>(); // OBLIGAMOS A SUPABASE A RESPETAR LA INTERFAZ

  if (error) throw new Error("Error al cargar pacientes.");
  if (!data) return [];

  return data.map((p) => {
    // Al estar tipado arriba, 'a' ya sabe que es { start_time: string; status: string }
    const completedApps =
      p.appointments?.filter((a) => a.status === "completed") || [];

    let lastVisitStr = null;
    if (completedApps.length > 0) {
      // Sort sin any
      const sortedApps = completedApps.sort(
        (a, b) =>
          new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
      );
      const lastDate = new Date(sortedApps[0].start_time);
      lastVisitStr = lastDate
        .toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
        .replace(/\./g, "");
    }

    return {
      id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      phone: p.phone || "Sin teléfono",
      dob: p.dob || undefined,
      gender: p.gender || undefined,
      bloodType: p.blood_type || undefined,
      allergies: p.allergies || undefined,
      chronicConditions: p.chronic_conditions || undefined,
      status: p.status,
      totalVisits: completedApps.length,
      lastVisit: lastVisitStr,
    };
  });
};

export const createPatient = async (
  firstName: string,
  lastName: string,
  phone: string,
  email?: string,
  dob?: string,
  gender?: string,
): Promise<void> => {
  const { error } = await supabase.from("patients").insert([
    {
      first_name: firstName,
      last_name: lastName,
      phone: phone,
      email: email,
      dob: dob,
      gender: gender,
      status: "active",
    },
  ]);

  if (error) throw new Error("Error al crear el paciente.");
};

export const updatePatientStatus = async (
  id: string,
  status: "active" | "blocked" | "archived",
): Promise<void> => {
  const { error } = await supabase
    .from("patients")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error("Error al actualizar el estado del paciente.");
};
