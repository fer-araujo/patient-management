import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { combineIsoDateAndTime } from "../../features/doctor/utils/calendarUtils";

/**
 * Booking failures raised on purpose by the RPCs carry the Postgres code P0001
 * and a message already written in Spanish for the patient. Anything else is an
 * internal fault whose text must not reach the UI.
 */
const toUserFacingError = (error: PostgrestError, fallback: string): Error =>
  new Error(error.code === "P0001" ? error.message : fallback);

const currentUserAgent = (): string | null =>
  typeof navigator !== "undefined" ? navigator.userAgent : null;

const splitFullName =(fullName: string): [string, string] => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "Sin apellido";
  return [firstName, lastName];
};

/** What the booking screen may know once the phone has been verified by OTP. */
export interface MyBookingProfile {
  isRegistered: boolean;
  firstName: string | null;
  needsConsent: boolean;
}

interface RawBookingProfile {
  is_registered: boolean;
  first_name: string | null;
  needs_consent: boolean;
}

/**
 * Resolves the verified caller against the patient list. Only safe AFTER the
 * OTP step: the session proves the caller owns the phone, so telling them
 * whether it is registered leaks nothing about anyone else.
 */
export const fetchMyBookingProfile = async (): Promise<MyBookingProfile> => {
  // A set-returning function: PostgREST answers with an array of one row.
  const { data, error } = await supabase.rpc("get_my_booking_profile");

  if (error) {
    console.error("[BookingService] get_my_booking_profile failed:", error);
    throw toUserFacingError(error, "No pudimos cargar tu información.");
  }

  const row = (data as RawBookingProfile[] | null)?.[0];
  return {
    isRegistered: row?.is_registered ?? false,
    firstName: row?.first_name ?? null,
    needsConsent: row?.needs_consent ?? true,
  };
};

export interface MyRegistration {
  fullName: string;
  email: string;
  birthYear: string;
  referredBy: string;
  /** Version of the privacy notice the visitor accepted on screen. */
  privacyNoticeVersion: string;
}

/**
 * Creates the verified caller's own clinical record and its consent row in one
 * transaction. The phone is taken from the session on the server; it is never
 * sent from the browser. Idempotent: an existing record is returned untouched.
 */
export const registerMe = async (data: MyRegistration): Promise<string> => {
  if (!data.privacyNoticeVersion) {
    throw new Error("Debes leer y aceptar el Aviso de Privacidad para continuar.");
  }

  const [firstName, lastName] = splitFullName(data.fullName);
  const birthYear = Number.parseInt(data.birthYear, 10);

  const { data: patientId, error } = await supabase.rpc("register_me", {
    p_first_name: firstName,
    p_last_name: lastName,
    p_email: data.email || null,
    p_referred_by: data.referredBy || null,
    p_dob_year: Number.isNaN(birthYear) ? null : birthYear,
    p_privacy_notice_version: data.privacyNoticeVersion,
    p_user_agent: currentUserAgent(),
  });

  if (error) {
    console.error("[BookingService] register_me failed:", error);
    throw toUserFacingError(error, "No se pudo crear tu expediente.");
  }

  return patientId as string;
};

/** Records a returning patient's acceptance of the current privacy notice. */
export const acceptPrivacyNotice = async (
  privacyNoticeVersion: string,
): Promise<void> => {
  const { error } = await supabase.rpc("accept_privacy_notice", {
    p_privacy_notice_version: privacyNoticeVersion,
    p_user_agent: currentUserAgent(),
  });

  if (error) {
    console.error("[BookingService] accept_privacy_notice failed:", error);
    throw toUserFacingError(error, "No se pudo registrar tu aceptación.");
  }
};

/**
 * Books for the verified caller. Used by both the public booking page (after
 * the OTP step) and the patient portal; the patient is resolved server-side
 * from the session, never from the browser.
 */
export const createMyAppointment = async (
  serviceId: string,
  date: string,
  time: string,
  reason: string,
): Promise<string> => {
  const { data: appointmentId, error } = await supabase.rpc(
    "request_my_appointment",
    {
      p_service_id: serviceId,
      p_start_time: combineIsoDateAndTime(date, time),
      p_reason: reason.trim() || null,
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
