import { supabase } from "../supabase";

// 1. INTERFAZ ESTRICTA PARA LA RESPUESTA DE LA BD (CERO ANYS)
interface RawAppointmentData {
  start_time: string;
  status: string;
}

interface RawPatientData {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
  blood_type: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  notes: string | null; // El Post-it global
  status: "active" | "blocked" | "archived";
  appointments: RawAppointmentData[] | null;
}

// 2. INTERFAZ PARA EL FRONTEND
export interface DashboardPatient {
  id: string;
  name: string;
  phone: string;
  email?: string;
  dob?: string;
  gender?: string;
  notes?: string;
  status: "active" | "blocked" | "archived";
  totalVisits: number;
  lastVisit: string | null;
}

// 3. CONSULTA DE PACIENTES
export const fetchPatients = async (): Promise<DashboardPatient[]> => {
  const { data, error } = await supabase
    .from("patients")
    .select(
      `
      id, first_name, last_name, phone, email, dob, gender, blood_type, allergies, chronic_conditions, notes, status,
      appointments ( start_time, status )
    `,
    )
    .order("first_name", { ascending: true }) // Orden alfabético para que no brinquen
    .returns<RawPatientData[]>(); // OBLIGAMOS A SUPABASE A RESPETAR LA INTERFAZ

  if (error) throw new Error("Error al cargar pacientes.");
  if (!data) return [];

  // Mapeo estrictamente tipado
  return data.map((p) => {
    const completedApps =
      p.appointments?.filter((a) => a.status === "completed") || [];

    let lastVisitStr = null;
    if (completedApps.length > 0) {
      const sortedApps = completedApps.sort(
        (a, b) =>
          new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
      );
      lastVisitStr = new Date(sortedApps[0].start_time)
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
      email: p.email || undefined,
      dob: p.dob || undefined,
      gender: p.gender || undefined,
      notes: p.notes || undefined, // Cargamos la nota real de la BD
      status: p.status,
      totalVisits: completedApps.length,
      lastVisit: lastVisitStr,
    };
  });
};

// 4. ACTUALIZAR EL POST-IT
export const updatePatientNotes = async (
  id: string,
  notes: string,
): Promise<void> => {
  const { error } = await supabase
    .from("patients")
    .update({ notes })
    .eq("id", id);
  if (error) throw new Error("Error al actualizar notas del paciente.");
};

// 5. CAMBIAR ESTATUS (Suspender/Archivar)
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

// 6. CREAR PACIENTE
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
      phone: phone || null,
      email: email || null,
      dob: dob || null,
      gender: gender || null,
      status: "active",
    },
  ]);

  if (error) throw new Error("Error al crear el paciente.");
};
