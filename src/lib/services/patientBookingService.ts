import { supabase } from "../supabase";
import { combineIsoDateAndTime } from "../../features/doctor/utils/calendarUtils";

export interface PublicBookingSubmission {
  phone: string;
  serviceId: string;
  date: string;
  time: string;
  fullName: string;
  email: string;
  reason: string;
  referredBy?: string;
}

export const createPublicPatientAndAppointment = async (
  data: PublicBookingSubmission,
): Promise<void> => {
  const nameParts = data.fullName.trim().split(" ");
  const firstName = nameParts[0] || "Paciente";
  const lastName = nameParts.slice(1).join(" ") || "Desconocido";

  // 🛡️ FIX VIP: Usamos la función RPC que ignora el bloqueo de seguridad (RLS)
  const { data: existingId, error: searchError } = await supabase.rpc(
    "get_patient_id_by_phone",
    { p_phone: data.phone },
  );

  if (searchError)
    throw new Error(`Error al verificar paciente: ${searchError.message}`);

  let patientId = existingId;

  if (!patientId) {
    const { data: newPatient, error: patientError } = await supabase
      .from("patients")
      .insert({
        first_name: firstName,
        last_name: lastName,
        phone: data.phone,
        email: data.email || null,
        status: "active",
        referred_by: data.referredBy || null,
        notes: data.reason ? `Motivo inicial: ${data.reason}` : null,
      })
      .select("id")
      .single();

    if (patientError)
      throw new Error(`Error al crear expediente: ${patientError.message}`);
    patientId = newPatient.id;
  }

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

  let phoneToSearch = user.phone || "";
  if (!phoneToSearch.startsWith("+")) {
    phoneToSearch = `+${phoneToSearch}`;
  }

  // 🛡️ FIX VIP: Buscamos por teléfono usando el RPC
  const { data: existingId, error: patientError } = await supabase.rpc(
    "get_patient_id_by_phone",
    { p_phone: phoneToSearch },
  );

  if (patientError || !existingId) {
    console.error(
      "[BookingService] Error al buscar expediente autenticado:",
      patientError,
    );
    throw new Error(
      "No se encontró un expediente clínico vinculado a tu cuenta.",
    );
  }

  const utcIsoDateTime = combineIsoDateAndTime(date, time);

  const { error: apptError } = await supabase.from("appointments").insert({
    patient_id: existingId, // Aquí usamos directamente el UUID devuelto
    service_id: serviceId,
    start_time: utcIsoDateTime,
    status: "pending",
  });

  if (apptError) {
    console.error("[BookingService] Error al insertar nueva cita:", apptError);
    throw new Error(`Error al registrar cita: ${apptError.message}`);
  }
};

// ============================================================================
// 🛡️ EL FIX PRINCIPAL DEL LOGIN
// ============================================================================
export const checkPatientExists = async (phone: string): Promise<boolean> => {
  // Llamamos a la función segura que no se bloquea por ser anónimos
  const { data: existingId, error } = await supabase.rpc(
    "get_patient_id_by_phone",
    { p_phone: phone },
  );

  if (error) {
    console.error("Error al buscar paciente:", error);
    return false;
  }

  // Si nos devuelve un UUID (letras y números), el paciente SÍ existe.
  return !!existingId;
};
