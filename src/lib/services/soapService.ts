import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export interface NoteAddendum {
  id: string;
  noteId: string;
  body: string;
  createdAt: string;
}

export interface SoapNote {
  id: string;
  appointmentId: string;
  patientId: string;
  subjective: string | null;
  objective: string | null;
  analysis: string | null;
  plan: string | null;
  createdAt: string;
  /** Set when the consultation was finalized; the note is frozen from then on. */
  finalizedAt: string | null;
  /** Append-only corrections, oldest first. */
  addenda: NoteAddendum[];
}

export interface MedicationItem {
  nombre: string;
  dosis: string;
  indicaciones: string;
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
  const addendaByNote = new Map<string, NoteAddendum[]>();

  if (noteIds.length > 0) {
    const { data: addendaData, error: addendaError } = await supabase
      .from("clinical_note_addenda")
      .select("id, note_id, body, created_at")
      .in("note_id", noteIds)
      .order("created_at", { ascending: true });

    if (addendaError)
      throw new Error(`Error cargando adendas: ${addendaError.message}`);

    for (const a of addendaData || []) {
      const list = addendaByNote.get(a.note_id) || [];
      list.push({
        id: a.id,
        noteId: a.note_id,
        body: a.body,
        createdAt: a.created_at,
      });
      addendaByNote.set(a.note_id, list);
    }
  }

  const notes: SoapNote[] = (notesData || []).map((n) => ({
    id: n.id,
    appointmentId: n.appointment_id,
    patientId: n.patient_id,
    subjective: n.subjective,
    objective: n.objective,
    analysis: n.analysis,
    plan: n.plan,
    createdAt: n.created_at,
    finalizedAt: n.finalized_at ?? null,
    addenda: addendaByNote.get(n.id) || [],
  }));

  const prescriptions: Prescription[] = (presData || []).map((p) => ({
    id: p.id,
    appointmentId: p.appointment_id,
    patientId: p.patient_id,
    medications: (p.medications as MedicationItem[]) || [],
    createdAt: p.created_at,
    finalizedAt: p.finalized_at ?? null,
  }));

  return { notes, prescriptions };
};

/**
 * Upserts the SOAP note of an in-progress consultation. Once the consultation
 * is finalized the database rejects any change; this checks first so the
 * doctor gets a clear message instead of a trigger error.
 */
export const saveSoapNote = async (
  appointmentId: string,
  patientId: string,
  subjective: string,
  objective: string,
  analysis: string,
  plan: string,
): Promise<void> => {
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
      .update({ subjective, objective, analysis, plan })
      .eq("id", existingNote.id);
    if (error) throw toClinicalError(error, "Error actualizando nota");
  } else {
    const { error } = await supabase.from("clinical_notes").insert([
      {
        appointment_id: appointmentId,
        patient_id: patientId,
        subjective,
        objective,
        analysis,
        plan,
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
