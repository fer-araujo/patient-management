import { supabase } from "../supabase";
import { normalizeToE164 } from "../phone";

// 1. INTERFAZ ESTRICTA PARA LA RESPUESTA DE LA BD (CERO ANYS)
interface RawAppointmentData {
  start_time: string;
  status: string;
}

interface RawPatientData {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
  blood_type: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  notes: string | null; // El Post-it global
  status: "active" | "blocked" | "archived";
  anonymized_at: string | null;
  appointments: RawAppointmentData[] | null;
}

// 2. INTERFAZ PARA EL FRONTEND
export interface DashboardPatient {
  id: string;
  name: string;
  phone: string;
  email?: string;
  dob?: string;
  gender?: string;
  notes?: string;
  status: "active" | "blocked" | "archived";
  /** Set once the record was anonymized (ARCO); it can never be restored. */
  anonymizedAt?: string | null;
  totalVisits: number;
  lastVisit: string | null;
}

// 3. CONSULTA DE PACIENTES
export const fetchPatients = async (): Promise<DashboardPatient[]> => {
  const { data, error } = await supabase
    .from("patients")
    .select(
      `
      id, first_name, last_name, phone, email, dob, gender, blood_type, allergies, chronic_conditions, notes, status, anonymized_at,
      appointments ( start_time, status )
    `,
    )
    .order("first_name", { ascending: true }) // Orden alfabético para que no brinquen
    .returns<RawPatientData[]>(); // OBLIGAMOS A SUPABASE A RESPETAR LA INTERFAZ

  if (error) throw new Error("Error al cargar pacientes.");
  if (!data) return [];

  // Mapeo estrictamente tipado
  return data.map((p) => {
    const completedApps =
      p.appointments?.filter((a) => a.status === "completed") || [];

    let lastVisitStr = null;
    if (completedApps.length > 0) {
      const sortedApps = completedApps.sort(
        (a, b) =>
          new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
      );
      lastVisitStr = new Date(sortedApps[0].start_time)
        .toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
        .replace(/\./g, "");
    }

    return {
      id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      phone: p.phone || "Sin teléfono",
      email: p.email || undefined,
      dob: p.dob || undefined,
      gender: p.gender || undefined,
      notes: p.notes || undefined, // Cargamos la nota real de la BD
      status: p.status,
      anonymizedAt: p.anonymized_at ?? null,
      totalVisits: completedApps.length,
      lastVisit: lastVisitStr,
    };
  });
};

// 4. ACTUALIZAR EL POST-IT
export const updatePatientNotes = async (
  id: string,
  notes: string,
): Promise<void> => {
  const { error } = await supabase
    .from("patients")
    .update({ notes })
    .eq("id", id);
  if (error) throw new Error("Error al actualizar notas del paciente.");
};

/**
 * The doctor's internal reminders ("Recordatorios Internos") of one patient,
 * so a consultation opens with them instead of an empty pad that would be
 * saved over them.
 */
export const fetchPatientNotes = async (id: string): Promise<string> => {
  const { data, error } = await supabase
    .from("patients")
    .select("notes")
    .eq("id", id)
    .maybeSingle<{ notes: string | null }>();
  if (error) throw new Error("Error al cargar los recordatorios del paciente.");
  return data?.notes ?? "";
};

// 5. CAMBIAR ESTATUS (Suspender/Archivar)
export const updatePatientStatus = async (
  id: string,
  status: "active" | "blocked" | "archived",
): Promise<void> => {
  const { error } = await supabase
    .from("patients")
    .update({ status })
    .eq("id", id);
  // P0001 carries a Spanish reason from the database (e.g. an anonymized
  // record cannot be restored); anything else stays generic.
  if (error)
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "Error al actualizar el estado del paciente.",
    );
};

// 6. CREAR PACIENTE
export const createPatient = async (
  firstName: string,
  lastName: string,
  phone: string,
  email?: string,
  dob?: string,
  gender?: string,
): Promise<void> => {
  const { error } = await supabase.from("patients").insert([
    {
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      email: email || null,
      dob: dob || null,
      gender: gender || null,
      status: "active",
    },
  ]);

  if (error) {
    // 23505 = unique_violation on the normalized-phone index (migration 15).
    if (error.code === "23505") {
      throw new Error("Ya existe un paciente con ese número de teléfono.");
    }
    throw new Error("Error al crear el paciente.");
  }
};

// 7. PERSONAL DATA (staff edit, e.g. an ARCO rectification request)

export const PATIENT_GENDERS = ["Femenino", "Masculino", "Otro"] as const;

/** Stored with an ASCII minus; the form shows a typographic one. */
export const BLOOD_TYPES = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;

/** The editable personal-data columns of public.patients. */
export interface PatientDetailsFields {
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  gender: string | null;
  dob: string | null;
  blood_type: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  address: string | null;
  /** Clinical history (NOM-004 6.1): antecedentes heredofamiliares. */
  family_history: string | null;
  /** Antecedentes personales patológicos. */
  personal_pathological_history: string | null;
  /** Antecedentes personales no patológicos. */
  non_pathological_history: string | null;
  /** Padecimiento actual. */
  current_illness: string | null;
}

export interface PatientDetails
  extends Omit<PatientDetailsFields, "first_name" | "phone"> {
  id: string;
  first_name: string | null;
  phone: string | null;
  anonymized_at: string | null;
}

export const ANONYMIZED_PATIENT_MESSAGE =
  "Este expediente fue anonimizado. Sus datos ya no se pueden editar.";

const PATIENT_DETAILS_COLUMNS =
  "id, first_name, last_name, phone, email, gender, dob, blood_type, allergies, chronic_conditions, address, family_history, personal_pathological_history, non_pathological_history, current_illness, anonymized_at";

/** Older rows may carry a typographic minus or lowercase ("o−"). */
const normalizeBloodType = (value: string | null): string | null => {
  if (!value) return null;
  return value.trim().toUpperCase().replace(/\u2212/g, "-") || null;
};

export const fetchPatientDetails = async (
  id: string,
): Promise<PatientDetails> => {
  const { data, error } = await supabase
    .from("patients")
    .select(PATIENT_DETAILS_COLUMNS)
    .eq("id", id)
    .maybeSingle<PatientDetails>();

  if (error) {
    // Only the code: the message may echo personal data.
    console.error("[patientService] fetchPatientDetails failed:", error.code);
    throw new Error("No se pudieron cargar los datos del paciente.");
  }
  if (!data) throw new Error("No encontramos a este paciente.");
  return { ...data, blood_type: normalizeBloodType(data.blood_type) };
};

const optionalText = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The clinical background ("Antecedentes") of a patient: patient-level data
 * the doctor can also fill in during a consultation.
 */
export type PatientBackgroundFields = Pick<
  PatientDetailsFields,
  | "blood_type"
  | "allergies"
  | "chronic_conditions"
  | "family_history"
  | "personal_pathological_history"
  | "non_pathological_history"
  | "current_illness"
>;

const PATIENT_BACKGROUND_KEYS: readonly (keyof PatientBackgroundFields)[] = [
  "blood_type",
  "allergies",
  "chronic_conditions",
  "family_history",
  "personal_pathological_history",
  "non_pathological_history",
  "current_illness",
];

/**
 * Normalizes and validates the background columns present in `fields`, and
 * only those: any other key is dropped.
 */
const toBackgroundPayload = (
  fields: Partial<PatientBackgroundFields>,
): Partial<PatientBackgroundFields> => {
  const payload: Partial<PatientBackgroundFields> = {};
  for (const key of PATIENT_BACKGROUND_KEYS) {
    if (!(key in fields)) continue;
    const value = optionalText(fields[key]);
    if (key === "blood_type") {
      const bloodType = normalizeBloodType(value);
      if (bloodType && !(BLOOD_TYPES as readonly string[]).includes(bloodType)) {
        throw new Error("Elige un tipo de sangre de la lista.");
      }
      payload.blood_type = bloodType;
    } else {
      payload[key] = value;
    }
  }
  return payload;
};

/**
 * Builds the update payload from the allowed columns only, so a caller can
 * never write status, notes, anonymized_at or any other column through here.
 */
const toPatientDetailsPayload = (
  fields: PatientDetailsFields,
): PatientDetailsFields => {
  const firstName = optionalText(fields.first_name);
  if (!firstName) throw new Error("Escribe el nombre del paciente.");

  const phone = normalizeToE164(fields.phone);
  if (!phone) throw new Error("Ingresa un teléfono válido a 10 dígitos.");

  const email = optionalText(fields.email);
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new Error("Revisa el correo electrónico.");
  }

  const gender = optionalText(fields.gender);
  if (gender && !(PATIENT_GENDERS as readonly string[]).includes(gender)) {
    throw new Error("Elige un género de la lista.");
  }

  const background = toBackgroundPayload({
    blood_type: fields.blood_type,
    allergies: fields.allergies,
    chronic_conditions: fields.chronic_conditions,
    family_history: fields.family_history,
    personal_pathological_history: fields.personal_pathological_history,
    non_pathological_history: fields.non_pathological_history,
    current_illness: fields.current_illness,
  }) as PatientBackgroundFields;

  const dob = optionalText(fields.dob);
  if (dob && !DATE_PATTERN.test(dob)) {
    throw new Error("Revisa la fecha de nacimiento.");
  }

  return {
    first_name: firstName,
    // Empty string instead of NULL: the patient list renders
    // `${first_name} ${last_name}` and would otherwise show "null".
    last_name: optionalText(fields.last_name) ?? "",
    phone,
    email,
    gender,
    dob,
    address: optionalText(fields.address),
    ...background,
  };
};

/**
 * Writes an already validated payload. An anonymized record is never
 * updated: the filter on anonymized_at makes the refusal atomic, and zero
 * updated rows means it was anonymized.
 */
const writePatientRow = async (
  id: string,
  payload: Partial<PatientDetailsFields>,
): Promise<void> => {
  const { data, error } = await supabase
    .from("patients")
    .update(payload)
    .eq("id", id)
    .is("anonymized_at", null)
    .select("id");

  if (error) {
    // 23505 = unique_violation on the normalized-phone index (migration 15).
    if (error.code === "23505") {
      throw new Error("Ya existe un paciente con ese número de teléfono.");
    }
    console.error("[patientService] patient update failed:", error.code);
    throw new Error("No se pudieron guardar los datos del paciente.");
  }
  if (!data || data.length === 0) {
    throw new Error(ANONYMIZED_PATIENT_MESSAGE);
  }
};

/**
 * Staff correction of a patient's personal data (RLS: patients_staff_all).
 * The audit_log trigger on public.patients records which columns changed.
 */
export const updatePatientDetails = async (
  id: string,
  fields: PatientDetailsFields,
): Promise<void> => {
  await writePatientRow(id, toPatientDetailsPayload(fields));
};

/**
 * Saves only the background columns the doctor changed during a
 * consultation, with the same validation and anonymization guard as
 * updatePatientDetails. Sending only what changed never overwrites the rest
 * of the record, nor a column edited meanwhile from the patient directory.
 */
export const updatePatientBackground = async (
  id: string,
  changes: Partial<PatientBackgroundFields>,
): Promise<void> => {
  const payload = toBackgroundPayload(changes);
  if (Object.keys(payload).length === 0) return;
  await writePatientRow(id, payload);
};
