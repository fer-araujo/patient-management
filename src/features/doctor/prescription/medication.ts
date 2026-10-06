import type { MedicationItem } from "../../../lib/services/soapService";

/** Routes offered in "Nueva Indicación" (closed list). */
export const MEDICATION_ROUTES = [
  "Oral",
  "Tópica",
  "Intradérmica",
  "Subcutánea",
  "Intramuscular",
  "Intravenosa",
  "Oftálmica",
  "Otra",
] as const;

export interface MedicationForm {
  nombre: string;
  presentacion: string;
  dosis: string;
  via: string;
  frecuencia: string;
  duracion: string;
  indicaciones: string;
}

export const EMPTY_MEDICATION_FORM: MedicationForm = {
  nombre: "",
  presentacion: "",
  dosis: "",
  via: "",
  frecuencia: "",
  duracion: "",
  indicaciones: "",
};

/** Keeps every item printable on the PDF. */
export const MEDICATION_LIMITS: Record<keyof MedicationForm, number> = {
  nombre: 120,
  presentacion: 120,
  dosis: 120,
  via: 20,
  frecuencia: 120,
  duracion: 80,
  indicaciones: 500,
};

const REQUIRED: { key: keyof MedicationForm; message: string }[] = [
  { key: "nombre", message: "Escribe el nombre del medicamento." },
  { key: "dosis", message: "Escribe la dosis." },
  { key: "via", message: "Elige la vía." },
  { key: "frecuencia", message: "Escribe cada cuánto se toma." },
];

export type MedicationErrors = Partial<Record<keyof MedicationForm, string>>;

/**
 * Checks "Nueva Indicación". Medicamento, Dosis, Vía and Frecuencia are
 * required (NOM-004 6.2.6: dose, route and frequency; RIS art. 30). Empty
 * optional fields are left out of the stored item.
 */
export const validateMedicationForm = (
  form: MedicationForm,
): { ok: true; value: MedicationItem } | { ok: false; errors: MedicationErrors } => {
  const errors: MedicationErrors = {};
  for (const { key, message } of REQUIRED) {
    if (!form[key].trim()) errors[key] = message;
  }
  if (form.via && !(MEDICATION_ROUTES as readonly string[]).includes(form.via)) {
    errors.via = "Elige la vía.";
  }
  for (const key of Object.keys(MEDICATION_LIMITS) as (keyof MedicationForm)[]) {
    if (!errors[key] && form[key].trim().length > MEDICATION_LIMITS[key]) {
      errors[key] = `Máximo ${MEDICATION_LIMITS[key]} caracteres.`;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const item: MedicationItem = {
    nombre: form.nombre.trim(),
    dosis: form.dosis.trim(),
    via: form.via,
    frecuencia: form.frecuencia.trim(),
    indicaciones: form.indicaciones.trim(),
  };
  if (form.presentacion.trim()) item.presentacion = form.presentacion.trim();
  if (form.duracion.trim()) item.duracion = form.duracion.trim();
  return { ok: true, value: item };
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Most medications one prescription (and its PDF) can hold. */
export const MAX_MEDICATIONS = 30;

export const TOO_MANY_MEDICATIONS_MESSAGE = `La receta admite hasta ${MAX_MEDICATIONS} medicamentos.`;

const isRoute = (value: string): boolean =>
  (MEDICATION_ROUTES as readonly string[]).includes(value);

/**
 * True when the item has everything "Nueva Indicación" requires today
 * (medication, dose, route, frequency). Items copied from prescriptions
 * written before migration 25 have no route or frequency and must be
 * completed before the consultation is finalized.
 */
export const isMedicationComplete = (med: MedicationItem): boolean =>
  !!text(med.nombre) && !!text(med.dosis) && isRoute(text(med.via)) && !!text(med.frecuencia);

/** The form prefilled with an existing item, to complete or correct it. */
export const medicationToForm = (med: MedicationItem): MedicationForm => ({
  nombre: text(med.nombre),
  presentacion: text(med.presentacion),
  dosis: text(med.dosis),
  via: isRoute(text(med.via)) ? text(med.via) : "",
  frecuencia: text(med.frecuencia),
  duracion: text(med.duracion),
  indicaciones: text(med.indicaciones),
});

/** Same medication, field by field (missing fields count as empty). */
export const sameMedication = (a: MedicationItem, b: MedicationItem): boolean =>
  (["nombre", "dosis", "indicaciones", "presentacion", "via", "frecuencia", "duracion"] as const).every(
    (key) => text(a[key]) === text(b[key]),
  );

/**
 * "Tabletas 400 mg · Vía oral · Cada 8 h · Por 5 días": the structured
 * fields that exist, for screens. Empty for items written before migration 25.
 */
export const describeMedicationSchedule = (med: MedicationItem): string =>
  [
    text(med.presentacion),
    text(med.via) ? `Vía ${text(med.via).toLowerCase()}` : "",
    text(med.frecuencia),
    text(med.duracion) ? `Por ${text(med.duracion).replace(/^por\s+/i, "")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
