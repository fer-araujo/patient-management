import { supabase } from "../supabase";

export interface SoapNote {
  id: string;
  appointmentId: string;
  patientId: string;
  subjective: string | null;
  objective: string | null;
  analysis: string | null;
  plan: string | null;
  createdAt: string;
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
}

export interface PatientClinicalHistory {
  notes: SoapNote[];
  prescriptions: Prescription[];
}

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

  const notes: SoapNote[] = (notesData || []).map((n) => ({
    id: n.id,
    appointmentId: n.appointment_id,
    patientId: n.patient_id,
    subjective: n.subjective,
    objective: n.objective,
    analysis: n.analysis,
    plan: n.plan,
    createdAt: n.created_at,
  }));

  const prescriptions: Prescription[] = (presData || []).map((p) => ({
    id: p.id,
    appointmentId: p.appointment_id,
    patientId: p.patient_id,
    medications: (p.medications as MedicationItem[]) || [],
    createdAt: p.created_at,
  }));

  return { notes, prescriptions };
};

export const saveSoapNote = async (
  appointmentId: string,
  patientId: string,
  subjective: string,
  objective: string,
  analysis: string,
  plan: string,
): Promise<void> => {
  const { data: existingNote } = await supabase
    .from("clinical_notes")
    .select("id")
    .eq("appointment_id", appointmentId)
    .single();

  if (existingNote) {
    const { error } = await supabase
      .from("clinical_notes")
      .update({ subjective, objective, analysis, plan })
      .eq("id", existingNote.id);
    if (error) throw new Error(`Error actualizando nota: ${error.message}`);
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
    if (error) throw new Error(`Error creando nota: ${error.message}`);
  }
};

export const savePrescription = async (
  appointmentId: string,
  patientId: string,
  medications: MedicationItem[],
): Promise<void> => {
  if (medications.length === 0) return;

  const { data: existingPrescription } = await supabase
    .from("prescriptions")
    .select("id")
    .eq("appointment_id", appointmentId)
    .single();

  if (existingPrescription) {
    const { error } = await supabase
      .from("prescriptions")
      .update({ medications })
      .eq("id", existingPrescription.id);
    if (error) throw new Error(`Error actualizando receta: ${error.message}`);
  } else {
    const { error } = await supabase.from("prescriptions").insert([
      {
        appointment_id: appointmentId,
        patient_id: patientId,
        medications,
      },
    ]);
    if (error) throw new Error(`Error creando receta: ${error.message}`);
  }
};
