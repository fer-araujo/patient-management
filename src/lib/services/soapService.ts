import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export interface NoteAddendum {
  id: string;
  noteId: string;
  body: string;
  createdAt: string;
  /** Full name of the author (NOM-004 5.10); null when unknown. */
  authorName?: string | null;
}

/** Stored in clinical_notes.vital_signs as numbers; every key is optional. */
export interface VitalSigns {
  bp_sys?: number;
  bp_dia?: number;
  spo2?: number;
  weight_kg?: number;
  height_cm?: number;
}

export interface SoapNote {
  id: string;
  appointmentId: string;
  patientId: string;
  subjective: string | null;
  objective: string | null;
  analysis: string | null;
  plan: string | null;
  prognosis: string | null;
  vitalSigns: VitalSigns | null;
  createdAt: string;
  /** Full name of the author (NOM-004 5.10); null when unknown. */
  authorName: string | null;
  /** Set when the consultation was finalized; the note is frozen from then on. */
  finalizedAt: string | null;
  /** Append-only corrections, oldest first. */
  addenda: NoteAddendum[];
}

/**
 * One medication of a prescription, stored in prescriptions.medications
 * (jsonb). The structured fields (migration 25) are optional: prescriptions
 * written before them stay valid, and an item copied from one of them into
 * today's prescription has no via or frecuencia until the doctor completes
 * it ("Completar"); the consultation cannot be finalized until every item of
 * today's prescription is complete (isMedicationComplete).
 */
export interface MedicationItem {
  /** Generic name (nombre genérico). */
  nombre: string;
  dosis: string;
  indicaciones: string;
  presentacion?: string;
  /** Route of administration, one of MEDICATION_ROUTES. */
  via?: string;
  frecuencia?: string;
  duracion?: string;
}

export interface Prescription {
  id: string;
  appointmentId: string;
  patientId: string;
  medications: MedicationItem[];
  createdAt: string;
  finalizedAt: string | null;
}

export interface PatientClinicalHistory {
  notes: SoapNote[];
  prescriptions: Prescription[];
}

/**
 * Integrity failures raised by the database triggers carry code P0001 and a
 * Spanish message meant for the doctor (e.g. "Esta consulta ya fue
 * finalizada..."). Anything else keeps the technical prefix for debugging.
 */
const toClinicalError = (error: PostgrestError, prefix: string): Error =>
  new Error(error.code === "P0001" ? error.message : `${prefix}: ${error.message}`);

const FINALIZED_NOTE_MESSAGE =
  "Esta consulta ya fue finalizada y no se puede modificar. Para corregir el expediente, agrega una nota aclaratoria (adenda) desde el Directorio de Pacientes.";

interface RawAddendum {
  id: string;
  note_id: string;
  body: string;
  created_at: string;
  author_id?: string | null;
}

/**
 * Resolves author ids to "First Last" from public.profiles (the doctor may
 * read every profile: profiles_select_staff). A missing name never blocks the
 * history; the note simply shows no author.
 */
const fetchAuthorNames = async (
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return names;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", unique);

  if (error) {
    console.error("[soapService] author names failed:", error.code);
    return names;
  }

  for (const p of (data as
    | { id: string; first_name: string | null; last_name: string | null }[]
    | null) || []) {
    const name = [p.first_name, p.last_name]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    if (name) names.set(p.id, name);
  }
  return names;
};

interface RawPrescription {
  id: string;
  appointment_id: string;
  patient_id: string;
  medications: unknown;
  created_at: string;
  finalized_at?: string | null;
}

const toPrescription = (p: RawPrescription): Prescription => ({
  id: p.id,
  appointmentId: p.appointment_id,
  patientId: p.patient_id,
  medications: (p.medications as MedicationItem[] | null) || [],
  createdAt: p.created_at,
  finalizedAt: p.finalized_at ?? null,
});

export const fetchPatientHistory = async (
  patientId: string,
): Promise<PatientClinicalHistory> => {
  const { data: notesData, error: notesError } = await supabase
    .from("clinical_notes")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (notesError)
    throw new Error(`Error cargando historial SOAP: ${notesError.message}`);

  const { data: presData, error: presError } = await supabase
    .from("prescriptions")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (presError)
    throw new Error(`Error cargando recetas: ${presError.message}`);

  const noteIds = (notesData || []).map((n) => n.id as string);
  const addendaRows: RawAddendum[] = [];

  if (noteIds.length > 0) {
    const { data: addendaData, error: addendaError } = await supabase
      .from("clinical_note_addenda")
      .select("id, note_id, body, created_at, author_id")
      .in("note_id", noteIds)
      .order("created_at", { ascending: true });

    if (addendaError)
      throw new Error(`Error cargando adendas: ${addendaError.message}`);

    addendaRows.push(...((addendaData as RawAddendum[] | null) || []));
  }

  const authorNames = await fetchAuthorNames([
    ...(notesData || []).map((n) => n.author_id as string | null),
    ...addendaRows.map((a) => a.author_id),
  ]);
  const nameOf = (id: string | null | undefined) =>
    (id && authorNames.get(id)) || null;

  const addendaByNote = new Map<string, NoteAddendum[]>();
  for (const a of addendaRows) {
    const list = addendaByNote.get(a.note_id) || [];
    list.push({
      id: a.id,
      noteId: a.note_id,
      body: a.body,
      createdAt: a.created_at,
      authorName: nameOf(a.author_id),
    });
    addendaByNote.set(a.note_id, list);
  }

  const notes: SoapNote[] = (notesData || []).map((n) => ({
    id: n.id,
    appointmentId: n.appointment_id,
    patientId: n.patient_id,
    subjective: n.subjective,
    objective: n.objective,
    analysis: n.analysis,
    plan: n.plan,
    prognosis: n.prognosis ?? null,
    vitalSigns: (n.vital_signs as VitalSigns | null) ?? null,
    createdAt: n.created_at,
    authorName: nameOf(n.author_id),
    finalizedAt: n.finalized_at ?? null,
    addenda: addendaByNote.get(n.id) || [],
  }));

  const prescriptions: Prescription[] = (presData || []).map(toPrescription);

  return { notes, prescriptions };
};

/**
 * The finalized prescription of one consultation, or null when it has none
 * (no medication was prescribed, or it is not finalized yet).
 */
export const fetchFinalizedPrescription = async (
  appointmentId: string,
): Promise<Prescription | null> => {
  const { data, error } = await supabase
    .from("prescriptions")
    .select("*")
    .eq("appointment_id", appointmentId)
    .not("finalized_at", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Error cargando receta: ${error.message}`);
  return data ? toPrescription(data) : null;
};

/** The editable content of a consultation note. */
export interface SoapNoteFields {
  subjective: string;
  objective: string;
  analysis: string;
  plan: string;
  prognosis: string;
  /** null when no vital sign was recorded. */
  vitalSigns: VitalSigns | null;
}

/**
 * Upserts the SOAP note of an in-progress consultation. Once the consultation
 * is finalized the database rejects any change; this checks first so the
 * doctor gets a clear message instead of a trigger error.
 */
export const saveSoapNote = async (
  appointmentId: string,
  patientId: string,
  fields: SoapNoteFields,
): Promise<void> => {
  const content = {
    subjective: fields.subjective,
    objective: fields.objective,
    analysis: fields.analysis,
    plan: fields.plan,
    prognosis: fields.prognosis,
    vital_signs: fields.vitalSigns,
  };

  const { data: existingNote, error: lookupError } = await supabase
    .from("clinical_notes")
    .select("id, finalized_at")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (lookupError)
    throw new Error(`Error consultando nota: ${lookupError.message}`);

  if (existingNote?.finalized_at) throw new Error(FINALIZED_NOTE_MESSAGE);

  if (existingNote) {
    const { error } = await supabase
      .from("clinical_notes")
      .update(content)
      .eq("id", existingNote.id);
    if (error) throw toClinicalError(error, "Error actualizando nota");
  } else {
    const { error } = await supabase.from("clinical_notes").insert([
      {
        appointment_id: appointmentId,
        patient_id: patientId,
        ...content,
      },
    ]);
    if (error) throw toClinicalError(error, "Error creando nota");
  }
};

export const savePrescription = async (
  appointmentId: string,
  patientId: string,
  medications: MedicationItem[],
): Promise<void> => {
  if (medications.length === 0) return;

  const { data: existingPrescription, error: lookupError } = await supabase
    .from("prescriptions")
    .select("id, finalized_at")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (lookupError)
    throw new Error(`Error consultando receta: ${lookupError.message}`);

  if (existingPrescription?.finalized_at)
    throw new Error(FINALIZED_NOTE_MESSAGE);

  if (existingPrescription) {
    const { error } = await supabase
      .from("prescriptions")
      .update({ medications })
      .eq("id", existingPrescription.id);
    if (error) throw toClinicalError(error, "Error actualizando receta");
  } else {
    const { error } = await supabase.from("prescriptions").insert([
      {
        appointment_id: appointmentId,
        patient_id: patientId,
        medications,
      },
    ]);
    if (error) throw toClinicalError(error, "Error creando receta");
  }
};

/**
 * Freezes the note and prescription of a consultation (NOM-004 integrity).
 * Called once from "Finalizar Consulta". Safe to call more than once.
 */
export const finalizeConsultation = async (
  appointmentId: string,
): Promise<void> => {
  const { error } = await supabase.rpc("finalize_consultation", {
    p_appointment_id: appointmentId,
  });
  if (error) throw toClinicalError(error, "Error finalizando consulta");
};

/** The charge collected by the "Cobro de la consulta" step. */
export interface ConsultationCharge {
  status: "paid" | "courtesy";
  /** Required (> 0) when status is "paid"; ignored for a courtesy. */
  amount?: number;
  /** Required when status is "paid"; ignored for a courtesy. */
  method?: "cash" | "card" | "transfer" | null;
  note?: string;
  /**
   * Supplies used in the consultation, possibly none. The server discounts
   * them from the inventory, computes their cost (the browser never sends a
   * cost) and marks the consultation as recorded. Absent = the supplies step
   * was not done; "Registrar insumos" can record them later.
   */
  supplies?: SupplyUse[];
}

export interface SupplyUse {
  itemId: string;
  quantity: number;
}

/** Only item and quantity, above 0: the cost is computed on the server. */
const toSupplyPayload = (supplies: SupplyUse[]) =>
  supplies
    .filter((s) => s.quantity > 0)
    .map((s) => ({ item_id: s.itemId, quantity: s.quantity }));

/**
 * "Finalizar Consulta": records the charge AND freezes the note and
 * prescription in one database transaction (finalize_consultation_with_payment,
 * migration 20). Either both happen or neither does, so a failure can simply
 * be retried. When the supplies step was done (even with none), they are
 * discounted and the consultation is marked in that same transaction
 * (migration 22).
 */
export const finalizeConsultationWithPayment = async (
  appointmentId: string,
  charge: ConsultationCharge,
): Promise<void> => {
  const isPaid = charge.status === "paid";
  const { error } = await supabase.rpc("finalize_consultation_with_payment", {
    p_appointment_id: appointmentId,
    p_status: charge.status,
    p_amount: isPaid ? charge.amount : 0,
    p_method: isPaid ? charge.method : null,
    p_note: charge.note?.trim() || null,
    // Left out when the step was not done: the server then leaves the
    // consultation pending instead of marking it as "used none".
    ...(charge.supplies !== undefined && {
      p_supplies: toSupplyPayload(charge.supplies),
    }),
  });
  if (error) {
    // P0001 carries a Spanish message meant for the doctor; anything else is
    // technical and only its code is logged.
    if (error.code === "P0001") throw new Error(error.message);
    console.error("[soapService] finalize_consultation_with_payment failed:", error.code);
    throw new Error(
      "No se pudo finalizar la consulta. No se guardó nada; intenta de nuevo.",
    );
  }
};

/**
 * "Registrar insumos" for a finalized consultation whose supplies step was
 * skipped (record_consultation_supplies, migration 22). Same checks and cost
 * rule as "Finalizar Consulta"; refused when they were already recorded.
 */
export const recordConsultationSupplies = async (
  appointmentId: string,
  supplies: SupplyUse[],
): Promise<void> => {
  const { error } = await supabase.rpc("record_consultation_supplies", {
    p_appointment_id: appointmentId,
    p_supplies: toSupplyPayload(supplies),
  });
  if (error) {
    if (error.code === "P0001") throw new Error(error.message);
    console.error("[soapService] record_consultation_supplies failed:", error.code);
    throw new Error("No se pudieron registrar los insumos. Intenta de nuevo.");
  }
};

/** Appends a correction to a finalized note. Addenda can never be edited. */
export const addNoteAddendum = async (
  noteId: string,
  body: string,
): Promise<NoteAddendum> => {
  const { data, error } = await supabase
    .from("clinical_note_addenda")
    .insert({ note_id: noteId, body: body.trim() })
    .select("id, note_id, body, created_at")
    .single();

  if (error) throw toClinicalError(error, "Error guardando adenda");

  return {
    id: data.id,
    noteId: data.note_id,
    body: data.body,
    createdAt: data.created_at,
  };
};

/**
 * The unfinalized note and prescription of this appointment, if any, so an
 * interrupted consultation reopens with what was already written. Uses the
 * oldest row, exactly like saveSoapNote/savePrescription, so the editor
 * shows the same record it will overwrite.
 */
export const findConsultationDraft = (
  history: PatientClinicalHistory,
  appointmentId: string,
): { note: SoapNote | null; prescription: Prescription | null } => {
  const oldest = <T extends { appointmentId: string; createdAt: string }>(
    rows: T[],
  ): T | undefined =>
    rows
      .filter((r) => r.appointmentId === appointmentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

  const note = oldest(history.notes);
  const prescription = oldest(history.prescriptions);
  return {
    note: note && !note.finalizedAt ? note : null,
    prescription:
      prescription && !prescription.finalizedAt ? prescription : null,
  };
};
