import type { SoapNote } from "../../../lib/services/soapService";

/** The written part of a clinical note, as typed (S, O, A, prognosis, P). */
export interface NoteForm {
  subjective: string;
  objective: string;
  analysis: string;
  prognosis: string;
  plan: string;
}

export const EMPTY_NOTE_FORM: NoteForm = {
  subjective: "",
  objective: "",
  analysis: "",
  prognosis: "",
  plan: "",
};

export const toNoteForm = (note: SoapNote): NoteForm => ({
  subjective: note.subjective ?? "",
  objective: note.objective ?? "",
  analysis: note.analysis ?? "",
  prognosis: note.prognosis ?? "",
  plan: note.plan ?? "",
});

/** The note fields in the consultation's order, labels and examples. */
export const NOTE_FIELDS: {
  key: keyof NoteForm;
  label: string;
  placeholder: string;
}[] = [
  { key: "subjective", label: "S - Motivo y Síntomas", placeholder: "Ej. Acude a revisión. Refiere..." },
  { key: "objective", label: "O - Exploración Física", placeholder: "¿Qué observas?" },
  { key: "analysis", label: "A - Diagnóstico (Análisis)", placeholder: "Ej. Paciente sano, sin hallazgos" },
  { key: "prognosis", label: "Pronóstico", placeholder: "Ej. Favorable" },
  { key: "plan", label: "P - Tratamiento (Plan)", placeholder: "Ej. Alta · Sin tratamiento · Revisión en 6 meses" },
];
