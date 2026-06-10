import { supabase } from "../supabase";

export interface PatientProfile {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  birthYear: string | null;
}

export interface PatientAppointment {
  id: string;
  serviceName: string;
  date: string;
  time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  durationMins: number;
  timestamp: number; // Útil para ordenar y separar pasadas de futuras
}

interface RawPatientAppointment {
  id: string;
  start_time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  services: { name: string; duration_mins: number } | null;
}

// 1. OBTENER EL PERFIL DEL PACIENTE LOGUEADO
export const fetchMyProfile = async (): Promise<PatientProfile> => {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("No hay sesión activa.");

  // Buscamos el paciente cuyo profile_id coincida con el ID del usuario autenticado
  const { data: patient, error } = await supabase
    .from("patients")
    .select("id, first_name, last_name, phone, email, notes")
    .eq("phone", user.phone) // Usamos el teléfono de auth como ancla de seguridad
    .single();

  if (error || !patient)
    throw new Error("No se pudo cargar el perfil del paciente.");

  return {
    id: patient.id,
    firstName: patient.first_name,
    lastName: patient.last_name,
    phone: patient.phone,
    email: patient.email,
    birthYear: null, // Si agregaste la columna birth_year, ponla aquí
  };
};

// 2. OBTENER EL HISTORIAL DE CITAS DEL PACIENTE
export const fetchMyAppointments = async (
  patientId: string,
): Promise<PatientAppointment[]> => {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      id,
      start_time,
      status,
      services ( name, duration_mins )
    `,
    )
    .eq("patient_id", patientId)
    .order("start_time", { ascending: true })
    .returns<RawPatientAppointment[]>();

  if (error) {
    console.error("Error fetching appointments:", error.message);
    throw new Error("No se pudieron cargar las citas.");
  }

  if (!data) return [];

  return data.map((apt: RawPatientAppointment) => {
    const startDate = new Date(apt.start_time);

    // Formateamos visualmente para el Dashboard
    const formattedDate = startDate
      .toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/\./g, "");

    const h = startDate.getHours();
    const m = String(startDate.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    const cleanTime = `${String(h12).padStart(2, "0")}:${m} ${ampm}`;

    return {
      id: apt.id,
      serviceName: apt.services?.name || "Consulta Médica",
      date: formattedDate,
      time: cleanTime,
      status: apt.status,
      durationMins: apt.services?.duration_mins || 60,
      timestamp: startDate.getTime(),
    };
  });
};
