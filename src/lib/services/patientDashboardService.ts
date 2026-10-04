import { supabase } from "../supabase";
import { getPatientFiles } from "./storageService";
import { formatClinicShortDate, formatClinicTime12h } from "../clinicTime";

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
  serviceId: string;
  serviceName: string;
  date: string;
  rawDate: string;
  time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  durationMins: number;
  timestamp: number;
}

interface RawPatientAppointment {
  id: string;
  service_id: string;
  start_time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  services: { name: string; duration_mins: number } | null;
}

export interface CarePlanItem {
  id: string | number;
  type: string;
  name: string;
  instruction: string;
  daysLeft: string;
}

interface RawJsonbMedication {
  id?: string | number;
  type?: string;
  name?: string;
  medicationName?: string;
  instruction?: string;
  dosage?: string;
  daysLeft?: string;
  duration?: string;
  // Shape written by the consultation workspace (soapService.MedicationItem).
  nombre?: string;
  dosis?: string;
  indicaciones?: string;
}

// 1. OBTENER EL PERFIL DEL PACIENTE LOGUEADO
export const fetchMyProfile = async (): Promise<
  PatientProfile & { fileCount: number }
> => {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("No hay sesión activa.");

  let phoneToSearch = user.phone || "";
  if (!phoneToSearch.startsWith("+")) phoneToSearch = `+${phoneToSearch}`;

  const { data: patient, error } = await supabase
    .from("patients")
    .select("id, first_name, last_name, phone, email, notes")
    .eq("phone", phoneToSearch)
    .single();

  if (error || !patient)
    throw new Error("No se pudo cargar el perfil del paciente.");

  // CONTAMOS LOS ARCHIVOS REALES EN EL BUCKET
  let fileCount = 0;
  try {
    const files = await getPatientFiles(patient.id);
    fileCount = files.length;
  } catch (e) {
    console.warn("No se pudieron contar los archivos", e);
  }

  return {
    id: patient.id,
    firstName: patient.first_name,
    lastName: patient.last_name,
    phone: patient.phone,
    email: patient.email,
    birthYear: null,
    fileCount,
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
      service_id,
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

    // Shown on the clinic's wall clock, whatever zone the patient browses from.
    const formattedDate = formatClinicShortDate(startDate);
    const cleanTime = formatClinicTime12h(startDate);

    return {
      id: apt.id,
      serviceId: apt.service_id,
      serviceName: apt.services?.name || "Consulta Médica",
      date: formattedDate,
      rawDate: apt.start_time,
      time: cleanTime,
      status: apt.status,
      durationMins: apt.services?.duration_mins || 60,
      timestamp: startDate.getTime(),
    };
  });
};

// OBTENER LA RECETA DEL PACIENTE (Desde la tabla existente con JSONB)
export const fetchMyCarePlan = async (
  patientId: string,
): Promise<CarePlanItem[]> => {
  // Traemos solo la receta más reciente del paciente
  const { data, error } = await supabase
    .from("prescriptions")
    .select("medications")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "[DashboardService] Error al cargar la receta desde Supabase:",
      error,
    );
    return [];
  }

  if (!data || !data.medications) return [];

  // Verificamos y casteamos el JSONB de forma segura
  const medsArray: RawJsonbMedication[] = Array.isArray(data.medications)
    ? (data.medications as RawJsonbMedication[])
    : [];

  // Mapeamos las propiedades al formato estándar del componente UI sin ANYs
  return medsArray.map((med, index) => ({
    id: med.id ?? index.toString(),
    type: med.type ?? "med",
    name:
      med.name ??
      med.medicationName ??
      ([med.nombre, med.dosis ? `(${med.dosis})` : ""]
        .filter(Boolean)
        .join(" ") ||
        "Tratamiento / Medicamento"),
    instruction:
      med.instruction ??
      med.dosage ??
      med.indicaciones ??
      "Ver indicaciones de la doctora",
    daysLeft: med.daysLeft ?? med.duration ?? "Continuo",
  }));
};
