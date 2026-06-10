import { supabase } from "../supabase";
// Importamos tu utilidad existente
import { combineIsoDateAndTime } from "../../features/doctor/utils/calendarUtils";

export interface PublicBookingSubmission {
  phone: string;
  serviceId: string;
  date: string;
  time: string;
  fullName: string;
  email: string;
  reason: string;
}

export const createPublicPatientAndAppointment = async (
  data: PublicBookingSubmission,
): Promise<void> => {
  const nameParts = data.fullName.trim().split(" ");
  const firstName = nameParts[0] || "Paciente";
  const lastName = nameParts.slice(1).join(" ") || "Desconocido";

  const { data: existingPatient, error: searchError } = await supabase
    .from("patients")
    .select("id")
    .eq("phone", data.phone)
    .maybeSingle();

  if (searchError)
    throw new Error(`Error al verificar paciente: ${searchError.message}`);

  let patientId = existingPatient?.id;

  if (!patientId) {
    const { data: newPatient, error: patientError } = await supabase
      .from("patients")
      .insert({
        first_name: firstName,
        last_name: lastName,
        phone: data.phone,
        email: data.email || null,
        status: "active",
        notes: data.reason ? `Motivo inicial: ${data.reason}` : null,
      })
      .select("id")
      .single();

    if (patientError)
      throw new Error(`Error al crear expediente: ${patientError.message}`);
    patientId = newPatient.id;
  }

  // USO DE TU UTILIDAD EXISTENTE
  const utcIsoDateTime = combineIsoDateAndTime(data.date, data.time);

  const { error: apptError } = await supabase.from("appointments").insert({
    patient_id: patientId,
    service_id: data.serviceId,
    start_time: utcIsoDateTime,
    status: "pending",
  });

  if (apptError)
    throw new Error(`Error al agendar la cita: ${apptError.message}`);
};

export const createAuthenticatedAppointment = async (
  serviceId: string,
  date: string,
  time: string,
): Promise<void> => {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sesión del paciente no encontrada.");

  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  if (patientError || !patient)
    throw new Error(
      "No se encontró un expediente clínico vinculado a tu cuenta.",
    );

  // USO DE TU UTILIDAD EXISTENTE
  const utcIsoDateTime = combineIsoDateAndTime(date, time);

  const { error: apptError } = await supabase.from("appointments").insert({
    patient_id: patient.id,
    service_id: serviceId,
    start_time: utcIsoDateTime,
    status: "pending",
  });

  if (apptError)
    throw new Error(`Error al registrar cita: ${apptError.message}`);
};

// Revisa si el paciente ya tiene un expediente basado en su número
export const checkPatientExists = async (phone: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from("patients")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    console.error("Error al buscar paciente:", error);
    return false;
  }

  return !!data; // Retorna true si encontró un registro
};
