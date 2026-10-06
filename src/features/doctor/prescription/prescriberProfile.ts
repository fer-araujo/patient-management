import type {
  PrescriberProfile,
  PrescriberProfileFields,
} from "../../../lib/services/prescriberService";

/** Same limits as prescriber_profile_values_check (migration 25). */
export const PRESCRIBER_LIMITS: Record<keyof PrescriberProfileFields, number> = {
  fullName: 120,
  cedulaProfesional: 12,
  especialidad: 120,
  cedulaEspecialidad: 12,
  institucionTitulo: 200,
  consultorioDomicilio: 300,
  telefono: 20,
};

const CEDULA = /^\d{4,12}$/;
const PHONE = /^[0-9 +()-]{7,20}$/;

export type PrescriberFieldErrors = Partial<Record<keyof PrescriberProfileFields, string>>;

/**
 * Format checks before saving (the database repeats them). Missing required
 * data is NOT an error here: she may save a partial profile and finish it
 * later; missingPrescriberItems() blocks the PDF instead.
 */
export const validatePrescriberFields = (
  fields: PrescriberProfileFields,
): PrescriberFieldErrors => {
  const errors: PrescriberFieldErrors = {};
  const cedula = fields.cedulaProfesional.replace(/\s/g, "");
  if (cedula && !CEDULA.test(cedula)) {
    errors.cedulaProfesional = "Escribe solo los números de la cédula.";
  }
  const cedulaEsp = fields.cedulaEspecialidad.replace(/\s/g, "");
  if (cedulaEsp && !CEDULA.test(cedulaEsp)) {
    errors.cedulaEspecialidad = "Escribe solo los números de la cédula.";
  } else if (cedulaEsp && !fields.especialidad.trim()) {
    errors.especialidad = "Escribe la especialidad de esa cédula.";
  }
  const phone = fields.telefono.trim();
  if (phone && !PHONE.test(phone)) {
    errors.telefono = "Escribe solo números y espacios.";
  }
  for (const key of Object.keys(PRESCRIBER_LIMITS) as (keyof PrescriberProfileFields)[]) {
    if (!errors[key] && fields[key].trim().length > PRESCRIBER_LIMITS[key]) {
      errors[key] = `Máximo ${PRESCRIBER_LIMITS[key]} caracteres.`;
    }
  }
  return errors;
};

/**
 * Printed items an official prescription lacks (RIS art. 29: full name,
 * cédula and address; the institution that issued the degree goes with the
 * cédula). Used on the issue snapshot, whose signature is checked apart.
 */
export const missingPrintedItems = (fields: PrescriberProfileFields): string[] => {
  const missing: string[] = [];
  if (!fields.fullName.trim()) missing.push("Nombre completo");
  if (!CEDULA.test(fields.cedulaProfesional.replace(/\s/g, ""))) {
    missing.push("Cédula profesional");
  }
  if (!fields.institucionTitulo.trim()) missing.push("Institución que expidió el título");
  if (!fields.consultorioDomicilio.trim()) missing.push("Domicilio del consultorio");
  return missing;
};

/**
 * What the doctor's current data still lacks to issue a prescription (the
 * printed items plus the signature). Empty when the PDF can be issued.
 */
export const missingPrescriberItems = (profile: PrescriberProfile): string[] => [
  ...missingPrintedItems(profile),
  ...(profile.hasSignature ? [] : ["Firma"]),
];
