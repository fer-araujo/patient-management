import {
  combineIsoDateAndTime,
  combineVisualDateAndTime,
} from "../../features/doctor/utils/calendarUtils";
import { clinicIsoDate, formatClinicShortDate, formatClinicTime12h } from "../clinicTime";
import { supabase } from "../supabase";
import { fetchAllRows } from "./fetchAllRows";
import { isNoteAwaitingClose, type VitalSigns } from "./soapService";

export interface DashboardAppointment {
  id: string;
  patientId: string;
  patientName: string;
  service: string;
  date: string;
  /** The appointment's day on the clinic calendar, "YYYY-MM-DD". */
  isoDate?: string;
  time: string;
  phone: string;
  isNewPatient: boolean;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  durationMins: number;
  /** "Motivo de la consulta" typed by the patient when booking. */
  reason: string | null;
  /** Catalog price of the service, used to pre-fill the charge. */
  servicePrice?: number | null;
  /** Catalog service, used to pre-fill the supplies used at checkout. */
  serviceId?: string | null;
  /**
   * Finalized without recording its supplies, and its service has supplies
   * configured: the calendar shows it in red with "Registrar insumos".
   */
  suppliesPending?: boolean;
  /**
   * Finalized (or recorded as a past visit) with its clinical note still
   * open: the calendar and the agenda show "Nota pendiente de cerrar".
   */
  notePending?: boolean;
  /** patients.status; an "archived" patient cannot be booked by the staff. */
  patientStatus?: "active" | "blocked" | "archived" | null;
}

// INTERFAZ ESTRICTA PARA SUPABASE (CERO 'any')
interface RawAppointmentData {
  id: string;
  start_time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  patient_id: string;
  service_id: string | null;
  reason: string | null;
  patients: {
    first_name: string;
    last_name: string;
    phone: string;
    status: "active" | "blocked" | "archived" | null;
  } | null;
  services: {
    name: string;
    duration_mins: number;
    price: number | string | null;
    service_supplies: { item_id: string }[] | null;
  } | null;
  clinical_notes:
    | {
        finalized_at: string | null;
        supplies_recorded_at: string | null;
        consultation_finalized_at?: string | null;
        recorded_late?: boolean | null;
      }[]
    | null;
}

/**
 * See DashboardAppointment.suppliesPending. Only a FINALIZED CONSULTATION
 * ("Finalizar Consulta" ran) can be flagged, whether or not its note was
 * closed yet (migration 31). A past visit transcribed from the paper agenda
 * (staff_record_past_visit) is never finalized that way, with or without a
 * note, so it never shows in red.
 */
const isSuppliesPending = (apt: RawAppointmentData): boolean => {
  if (apt.status === "cancelled" || apt.status === "rejected") return false;
  const notes = apt.clinical_notes ?? [];
  return (
    (apt.services?.service_supplies?.length ?? 0) > 0 &&
    notes.some((n) => (n.consultation_finalized_at ?? null) !== null) &&
    !notes.some((n) => n.supplies_recorded_at !== null)
  );
};

/** See DashboardAppointment.notePending (same rule as isNoteAwaitingClose). */
const isNotePending = (apt: RawAppointmentData): boolean => {
  if (apt.status === "cancelled" || apt.status === "rejected") return false;
  return (apt.clinical_notes ?? []).some((n) =>
    isNoteAwaitingClose({
      finalizedAt: n.finalized_at,
      consultationFinalizedAt: n.consultation_finalized_at ?? null,
      recordedLate: n.recorded_late === true,
    }),
  );
};

export const fetchDoctorAppointments = async (): Promise<
  DashboardAppointment[]
> => {
  // Every appointment ever, so it is paged: one request stops at max_rows
  // (1000) and, sorted ascending, would drop the NEWEST ones.
  const { data, error } = await fetchAllRows<RawAppointmentData>((from, to) =>
    supabase
      .from("appointments")
      .select(
      `
      id,
      start_time,
      status,
      patient_id,
      service_id,
      reason,
      patients (
        first_name,
        last_name,
        phone,
        status
      ),
      services (
        name,
        duration_mins,
        price,
        service_supplies ( item_id )
      ),
      clinical_notes ( finalized_at, supplies_recorded_at, consultation_finalized_at, recorded_late )
    `,
      )
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
      .returns<RawAppointmentData[]>(),
  );

  if (error) {
    console.error("Error al obtener las citas:", error.message);
    throw new Error("No se pudieron cargar las citas");
  }

  if (!data) return [];

  return data.map((apt) => {
    // Clinic wall clock, so the calendar grid, past-slot checks and
    // availability (all in clinic time) agree whatever the browser zone.
    const startDate = new Date(apt.start_time);
    const formattedDate = formatClinicShortDate(startDate);
    const cleanTime = formatClinicTime12h(startDate);

    const firstName = apt.patients?.first_name || "Paciente";
    const lastName = apt.patients?.last_name || "Desconocido";
    const phone = apt.patients?.phone || "Sin teléfono";
    const serviceName = apt.services?.name || "Servicio eliminado";
    const duration = apt.services?.duration_mins || 60;

    return {
      id: apt.id,
      patientId: apt.patient_id,
      patientName: `${firstName} ${lastName}`,
      service: serviceName,
      date: formattedDate,
      isoDate: clinicIsoDate(startDate),
      time: cleanTime,
      phone: phone,
      isNewPatient: true,
      status: apt.status,
      durationMins: duration,
      reason: apt.reason?.trim() || null,
      servicePrice:
        apt.services?.price === null || apt.services?.price === undefined
          ? null
          : Number(apt.services.price),
      patientStatus: apt.patients?.status ?? null,
      serviceId: apt.service_id ?? null,
      suppliesPending: isSuppliesPending(apt),
      notePending: isNotePending(apt),
    };
  });
};

// 2. ACTUALIZAR ESTADO (Aprobar, Rechazar, Cancelar, Completar)
export const updateAppointmentStatus = async (
  id: string,
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected",
) => {
  // updated_by is never sent from the client: the appointments_set_updated_by
  // trigger derives it from the caller's role, so a patient session cannot make
  // a change look like it came from the doctor.
  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("Error al actualizar estado:", error.message);
    throw new Error("No se pudo actualizar la cita.");
  }
};

/** Slot conflicts raised on purpose by the booking RPCs carry code P0001 and a Spanish message. */
const rpcError = (error: { code?: string; message: string }, fallback: string) =>
  new Error(error.code === "P0001" ? error.message : fallback);

// 3. CREAR NUEVA CITA (Agendar)
// serviceId comes from the active catalog (useBookingCatalog); the RPC refuses
// an id that is not in the catalog.
export const createAppointment = async (
  patientId: string,
  serviceId: string,
  dateStr: string,
  timeStr: string,
) => {
  // Usamos el nuevo traductor que respeta tu zona horaria
  const utcIsoDateTime = combineVisualDateAndTime(dateStr, timeStr);

  // staff_create_appointment runs the same locked overlap check as patient
  // bookings, so two bookings can never take the same slot at once.
  const { error } = await supabase.rpc("staff_create_appointment", {
    p_patient_id: patientId,
    p_service_id: serviceId,
    p_start_time: utcIsoDateTime,
  });

  if (error) {
    console.error("Error al crear cita:", error.message);
    throw rpcError(error, "No se pudo agendar la cita.");
  }
};

// 3b. REGISTRAR CITA PASADA (staff)
export interface PastVisitInput {
  patientId: string;
  serviceId: string;
  /** Clinic calendar day, "YYYY-MM-DD". */
  isoDate: string;
  /** Clinic wall-clock start, "hh:mm AM/PM". */
  time: string;
  paymentStatus: "paid" | "courtesy";
  /** Required (> 0) when paid; ignored for a courtesy. */
  amount?: number;
  /** Required when paid; ignored for a courtesy. */
  method?: "cash" | "card" | "transfer" | null;
  note?: string;
  /**
   * Optional "Nota clínica" of the visit. Saved OPEN (to complete and close
   * later from the record) and marked as recorded after the fact.
   */
  clinicalNote?: PastVisitNote;
}

export interface PastVisitNote {
  subjective: string;
  objective: string;
  analysis: string;
  prognosis: string;
  plan: string;
  /** null when no vital sign was recorded. */
  vitalSigns: VitalSigns | null;
}

const hasNoteContent = (note: PastVisitNote | undefined): note is PastVisitNote =>
  !!note &&
  ([note.subjective, note.objective, note.analysis, note.prognosis, note.plan].some(
    (text) => text.trim() !== "",
  ) ||
    note.vitalSigns !== null);

/**
 * Records a visit that already happened (transcribed from the paper agenda)
 * and its charge in one transaction. The server refuses a future start, an
 * occupied time and an archived patient, and dates the charge to the visit so
 * Finanzas counts it on that day. With a clinical note, the note is saved in
 * that same transaction (staff_record_past_visit_with_note, migration 31).
 * Returns the new appointment's id.
 */
export const recordPastVisit = async (
  input: PastVisitInput,
  now: number = Date.now(),
): Promise<string> => {
  if (!input.patientId) throw new Error("Elige el paciente.");
  if (!input.serviceId) throw new Error("Elige el servicio.");
  if (!input.isoDate || !input.time) throw new Error("Elige la fecha y la hora.");

  const startIso = combineIsoDateAndTime(input.isoDate, input.time);
  if (new Date(startIso).getTime() > now) {
    throw new Error("Esa hora todavía no pasa. Usa Agendar Cita para citas futuras.");
  }

  const isPaid = input.paymentStatus === "paid";
  if (isPaid) {
    if (
      input.amount === undefined ||
      !Number.isFinite(input.amount) ||
      input.amount <= 0
    ) {
      throw new Error("Indica cuánto cobraste (más de 0).");
    }
    if (!input.method) throw new Error("Indica cómo te pagaron.");
  }

  const visit = {
    p_patient_id: input.patientId,
    p_service_id: input.serviceId,
    p_start_time: startIso,
    p_payment_status: input.paymentStatus,
    p_amount: isPaid ? input.amount : 0,
    p_method: isPaid ? input.method : null,
    p_note: input.note?.trim() || null,
  };
  const clinicalNote = input.clinicalNote;
  const { data, error } = hasNoteContent(clinicalNote)
    ? await supabase.rpc("staff_record_past_visit_with_note", {
        ...visit,
        p_subjective: clinicalNote.subjective.trim() || null,
        p_objective: clinicalNote.objective.trim() || null,
        p_analysis: clinicalNote.analysis.trim() || null,
        p_prognosis: clinicalNote.prognosis.trim() || null,
        p_plan: clinicalNote.plan.trim() || null,
        p_vital_signs: clinicalNote.vitalSigns,
      })
    : await supabase.rpc("staff_record_past_visit", visit);

  if (error) {
    console.error("Error al registrar la cita pasada:", error.code);
    throw rpcError(error, "No se pudo guardar la cita pasada.");
  }
  return data as string;
};

// 4. REPROGRAMAR CITA (staff)
// Patients use rescheduleMyAppointment in patientBookingService instead: RLS
// gives them no UPDATE privilege on appointments. The RPC checks the new slot
// (ignoring the appointment itself) and sets the status back to "pending".
export const rescheduleAppointment = async (
  id: string,
  isoDateTime: string,
) => {
  const { error } = await supabase.rpc("staff_reschedule_appointment", {
    p_appointment_id: id,
    p_start_time: isoDateTime,
  });

  if (error) {
    console.error("Error al reprogramar:", error.message);
    throw rpcError(error, "No se pudo reprogramar la cita.");
  }
};

// 5. CANCELAR CITA (staff) - ver cancelMyAppointment para el portal del paciente
export const cancelAppointment = async (id: string, reason: string) => {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancel_reason: reason,
    })
    .eq("id", id);
  if (error) throw new Error("No se pudo cancelar la cita.");
};
