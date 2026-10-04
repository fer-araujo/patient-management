import type { PostgrestError } from "@supabase/supabase-js";
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

/**
 * Booking failures raised on purpose by the RPCs carry the Postgres code P0001
 * and a message already written in Spanish for the patient. Anything else is an
 * internal fault whose text must not reach the UI.
 */
const toUserFacingError = (error: PostgrestError, fallback: string): Error =>
  new Error(error.code === "P0001" ? error.message : fallback);

const splitFullName = (fullName: string): [string, string] => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "Paciente";
  const lastName = parts.slice(1).join(" ") || "Sin apellido";
  return [firstName, lastName];
};

/**
 * Anonymous booking.
 *
 * The whole find-or-create-then-insert sequence happens inside the
 * request_appointment RPC. The browser no longer looks a patient up by phone
 * first, so the public booking screen cannot be used to discover whether a
 * given number belongs to a patient of the clinic.
 */
export const createPublicPatientAndAppointment = async (
  data: PublicBookingSubmission,
): Promise<string> => {
  const [firstName, lastName] = splitFullName(data.fullName);

  const { data: appointmentId, error } = await supabase.rpc(
    "request_appointment",
    {
      p_phone: data.phone,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: data.email || null,
      p_service_id: data.serviceId,
      p_start_time: combineIsoDateAndTime(data.date, data.time),
      p_reason: data.reason || null,
      p_referred_by: data.referredBy || null,
    },
  );

  if (error) {
    console.error("[BookingService] request_appointment failed:", error);
    throw toUserFacingError(error, "No se pudo registrar tu solicitud de cita.");
  }

  return appointmentId as string;
};

/** Booking from the logged-in patient portal. */
export const createAuthenticatedAppointment = async (
  serviceId: string,
  date: string,
  time: string,
): Promise<string> => {
  const { data: appointmentId, error } = await supabase.rpc(
    "request_my_appointment",
    {
      p_service_id: serviceId,
      p_start_time: combineIsoDateAndTime(date, time),
    },
  );

  if (error) {
    console.error("[BookingService] request_my_appointment failed:", error);
    throw toUserFacingError(error, "No se pudo registrar tu cita.");
  }

  return appointmentId as string;
};

/** Cancellation performed by the patient on their own appointment. */
export const cancelMyAppointment = async (
  appointmentId: string,
  reason: string,
): Promise<void> => {
  const { error } = await supabase.rpc("cancel_my_appointment", {
    p_appointment_id: appointmentId,
    p_reason: reason,
  });

  if (error) {
    console.error("[BookingService] cancel_my_appointment failed:", error);
    throw toUserFacingError(error, "No se pudo cancelar la cita.");
  }
};

/** Reschedule performed by the patient on their own appointment. */
export const rescheduleMyAppointment = async (
  appointmentId: string,
  isoDateTime: string,
): Promise<void> => {
  const { error } = await supabase.rpc("reschedule_my_appointment", {
    p_appointment_id: appointmentId,
    p_start_time: isoDateTime,
  });

  if (error) {
    console.error("[BookingService] reschedule_my_appointment failed:", error);
    throw toUserFacingError(error, "No se pudo reprogramar la cita.");
  }
};
