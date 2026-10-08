/**
 * Which WhatsApp message, if any, an appointments webhook event deserves.
 *
 * The whatsapp_notifications trigger fires on EVERY insert and update of
 * public.appointments, including updates that only touch bookkeeping columns
 * (notes, patient_reschedule_count, updated_by, ...). Each message is a paid
 * Twilio send, so a message goes out only when the event changed something the
 * patient cares about:
 *
 *   event   condition                                              message
 *   ------  -----------------------------------------------------  ----------------
 *   INSERT  status = confirmed (booked by the clinic)              booked_confirmed
 *   INSERT  status = pending (online request)                      request_received
 *   INSERT  any other status                                       none
 *   UPDATE  status changed to cancelled                            cancelled
 *   UPDATE  start_time changed and status is pending or confirmed  rescheduled
 *   UPDATE  status changed to confirmed (start_time unchanged)     confirmed
 *   UPDATE  anything else (same status and same start_time, a      none
 *           change to completed/rejected, a moved cancelled row)
 *   UPDATE  without old_record (a change cannot be proven)         none
 *   DELETE  (the trigger does not fire on delete)                  none
 *
 * A cancellation wins over a reschedule when both change at once; a reschedule
 * wins over a confirmation (its message carries the new date).
 *
 * Pure on purpose: no Deno, network or database access, so it runs on the
 * edge AND in the Vitest suite (src/lib/notifications/).
 */

export type NotificationKind =
  | "booked_confirmed"
  | "request_received"
  | "cancelled"
  | "rescheduled"
  | "confirmed";

export interface AppointmentSnapshot {
  status?: unknown;
  start_time?: unknown;
}

export interface AppointmentEvent {
  type?: unknown;
  record?: AppointmentSnapshot | null;
  old_record?: AppointmentSnapshot | null;
}

/** Same instant even if Postgres serialized the two values differently. */
const sameInstant = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== "string" || typeof b !== "string") return false;
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  return !Number.isNaN(timeA) && timeA === timeB;
};

export const decideNotification = (
  event: AppointmentEvent,
): NotificationKind | null => {
  const record = event.record;
  if (!record) return null;

  if (event.type === "INSERT") {
    if (record.status === "confirmed") return "booked_confirmed";
    if (record.status === "pending") return "request_received";
    return null;
  }

  if (event.type !== "UPDATE") return null;

  const oldRecord = event.old_record;
  if (!oldRecord) return null;

  const statusChanged = oldRecord.status !== record.status;
  const startChanged = !sameInstant(oldRecord.start_time, record.start_time);

  if (statusChanged && record.status === "cancelled") return "cancelled";

  if (
    startChanged &&
    (record.status === "pending" || record.status === "confirmed")
  ) {
    return "rescheduled";
  }

  if (statusChanged && record.status === "confirmed") return "confirmed";

  return null;
};
