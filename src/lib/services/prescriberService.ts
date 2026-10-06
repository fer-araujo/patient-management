import { supabase } from "../supabase";

/**
 * The doctor's official prescription data (RIS art. 29), her drawn
 * signature and the issue of a prescription (migration 25). Doctor only:
 * RLS is_staff() on public.prescriber_profile and on the private bucket
 * prescriber_private. The prescription PDF is built in her browser from the
 * snapshot issue_prescription() stores, never from the current data.
 */

export const SIGNATURE_BUCKET = "prescriber_private";
/** Object names the storage policy accepts (one per signature version). */
export const SIGNATURE_OBJECT_PATTERN = /^signature-[A-Za-z0-9_-]+\.png$/;
/** Same cap as the bucket's file_size_limit (256 KB). */
export const SIGNATURE_MAX_BYTES = 262144;

export interface PrescriberProfileFields {
  fullName: string;
  cedulaProfesional: string;
  especialidad: string;
  cedulaEspecialidad: string;
  institucionTitulo: string;
  consultorioDomicilio: string;
  telefono: string;
}

export interface PrescriberProfile extends PrescriberProfileFields {
  /** True once a signature was saved (signature_path is set). */
  hasSignature: boolean;
  /** Object name of the current signature version ("" when none). */
  signaturePath: string;
}

export const EMPTY_PRESCRIBER_PROFILE: PrescriberProfile = {
  fullName: "",
  cedulaProfesional: "",
  especialidad: "",
  cedulaEspecialidad: "",
  institucionTitulo: "",
  consultorioDomicilio: "",
  telefono: "",
  hasSignature: false,
  signaturePath: "",
};

/**
 * How the PDF left the app (log_prescription_shared):
 *   - share_sheet: the system share sheet finished (she picked a chat);
 *   - whatsapp_link: the PDF was downloaded AND the WhatsApp chat opened;
 *   - download: the PDF was only downloaded (no chat could be opened);
 *   - print: the PDF opened in a tab to view or print.
 */
export type PrescriptionShareChannel = "share_sheet" | "whatsapp_link" | "download" | "print";

/** What issue_prescription() stored at the first issue; never changes. */
export interface IssuedPrescription {
  folio: number;
  issuedAt: string;
  /** Signature version used at the first issue. */
  signaturePath: string;
  /** The printed prescriber data at the first issue. */
  prescriber: PrescriberProfileFields;
}

/** The server refused to issue: the prescriber data or signature is missing. */
export class PrescriberIncompleteError extends Error {
  constructor() {
    super("Faltan datos de la receta.");
    this.name = "PrescriberIncompleteError";
  }
}

interface ProfileRow {
  full_name: string | null;
  cedula_profesional: string | null;
  especialidad: string | null;
  cedula_especialidad: string | null;
  institucion_titulo: string | null;
  consultorio_domicilio: string | null;
  telefono: string | null;
  signature_path: string | null;
}

const COLUMNS =
  "full_name, cedula_profesional, especialidad, cedula_especialidad, institucion_titulo, consultorio_domicilio, telefono, signature_path";

const toProfile = (row: ProfileRow | null): PrescriberProfile =>
  row
    ? {
        fullName: row.full_name ?? "",
        cedulaProfesional: row.cedula_profesional ?? "",
        especialidad: row.especialidad ?? "",
        cedulaEspecialidad: row.cedula_especialidad ?? "",
        institucionTitulo: row.institucion_titulo ?? "",
        consultorioDomicilio: row.consultorio_domicilio ?? "",
        telefono: row.telefono ?? "",
        hasSignature: !!row.signature_path,
        signaturePath: row.signature_path ?? "",
      }
    : { ...EMPTY_PRESCRIBER_PROFILE };

/** Empty text is stored as null, so "not filled in" has one meaning. */
const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/** The prescription data, or an empty profile when none was saved yet. */
export const fetchPrescriberProfile = async (): Promise<PrescriberProfile> => {
  const { data, error } = await supabase
    .from("prescriber_profile")
    .select(COLUMNS)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[prescriberService] read failed:", error.code);
    throw new Error("No se pudieron cargar los datos de la receta.");
  }
  return toProfile(data as ProfileRow | null);
};

/**
 * Saves the text fields of the single row (insert the first time, update
 * afterwards). The signature path is not touched.
 */
export const savePrescriberProfile = async (
  fields: PrescriberProfileFields,
): Promise<void> => {
  const especialidad = orNull(fields.especialidad);
  const { error } = await supabase.from("prescriber_profile").upsert(
    {
      full_name: orNull(fields.fullName),
      cedula_profesional: orNull(fields.cedulaProfesional.replace(/\s/g, "")),
      especialidad,
      // A specialty cédula only makes sense with its specialty.
      cedula_especialidad: especialidad
        ? orNull(fields.cedulaEspecialidad.replace(/\s/g, ""))
        : null,
      institucion_titulo: orNull(fields.institucionTitulo),
      consultorio_domicilio: orNull(fields.consultorioDomicilio),
      telefono: orNull(fields.telefono),
    },
    { onConflict: "singleton" },
  );
  if (error) {
    console.error("[prescriberService] save failed:", error.code);
    if (error.code === "23514") {
      throw new Error(
        "Revisa los datos: las cédulas llevan solo números y el teléfono solo números y espacios.",
      );
    }
    throw new Error("No se pudieron guardar los datos de la receta.");
  }
};

/** A new, unique object name for one signature version. */
export const newSignatureObjectName = (): string => {
  const random = Math.random().toString(36).slice(2, 10) || "0";
  return `signature-${Date.now().toString(36)}-${random}.png`;
};

/**
 * Stores the drawn signature (PNG) as a NEW version in the private bucket
 * and points the profile to it. Earlier versions are kept: issued
 * prescriptions still print the signature they were issued with. Returns
 * the new object name.
 */
export const uploadSignature = async (png: Blob): Promise<string> => {
  if (png.type && png.type !== "image/png") {
    throw new Error("La firma debe ser una imagen PNG.");
  }
  if (png.size > SIGNATURE_MAX_BYTES) {
    throw new Error("La firma es demasiado grande. Bórrala y dibújala de nuevo.");
  }

  const path = newSignatureObjectName();
  const { error: uploadError } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, png, {
      upsert: false,
      contentType: "image/png",
      cacheControl: "3600",
    });
  if (uploadError) {
    console.error("[prescriberService] signature upload failed");
    throw new Error("No se pudo guardar la firma. Intenta de nuevo.");
  }

  const { error } = await supabase
    .from("prescriber_profile")
    .upsert({ signature_path: path }, { onConflict: "singleton" });
  if (error) {
    console.error("[prescriberService] signature path failed:", error.code);
    throw new Error("No se pudo guardar la firma. Intenta de nuevo.");
  }
  return path;
};

/**
 * One signature version, read with the doctor's session (never a public
 * URL). Null when the bucket returned nothing.
 */
export const downloadSignature = async (path: string): Promise<Blob | null> => {
  if (!SIGNATURE_OBJECT_PATTERN.test(path)) {
    throw new Error("No se pudo cargar la firma guardada.");
  }
  const { data, error } = await supabase.storage.from(SIGNATURE_BUCKET).download(path);
  if (error) {
    console.error("[prescriberService] signature download failed");
    throw new Error("No se pudo cargar la firma guardada.");
  }
  return (data as Blob | null) ?? null;
};

interface IssueRow {
  folio: number | string;
  issued_at: string;
  signature_path: string;
  prescriber: Partial<Record<keyof ProfileRow, string | null>> | null;
}

/**
 * Issues a FINALIZED prescription: the first call stores the prescriber
 * data, the signature version, the date and a sequential folio; every later
 * call returns that same snapshot. Throws PrescriberIncompleteError when the
 * doctor's data or signature is missing.
 */
export const issuePrescription = async (prescriptionId: string): Promise<IssuedPrescription> => {
  const { data, error } = await supabase.rpc("issue_prescription", {
    p_prescription_id: prescriptionId,
  });
  if (error) {
    console.error("[prescriberService] issue_prescription failed:", error.code);
    if (error.code === "P0001" && error.hint === "prescriber_incomplete") {
      throw new PrescriberIncompleteError();
    }
    throw new Error(
      error.code === "P0001" || error.code === "42501"
        ? error.message
        : "No se pudo emitir la receta. Intenta de nuevo.",
    );
  }
  const row = data as IssueRow | null;
  const folio = Number(row?.folio);
  if (!row || !Number.isSafeInteger(folio) || folio <= 0 || !row.issued_at || !row.signature_path) {
    throw new Error("No se pudo emitir la receta. Intenta de nuevo.");
  }
  const p = row.prescriber ?? {};
  return {
    folio,
    issuedAt: row.issued_at,
    signaturePath: row.signature_path,
    prescriber: {
      fullName: p.full_name ?? "",
      cedulaProfesional: p.cedula_profesional ?? "",
      especialidad: p.especialidad ?? "",
      cedulaEspecialidad: p.cedula_especialidad ?? "",
      institucionTitulo: p.institucion_titulo ?? "",
      consultorioDomicilio: p.consultorio_domicilio ?? "",
      telefono: p.telefono ?? "",
    },
  };
};

/**
 * Audits that an issued prescription left the app as a PDF. The server logs
 * the channel, folio and issue time only, never its content.
 */
export const logPrescriptionShared = async (
  prescriptionId: string,
  channel: PrescriptionShareChannel,
): Promise<void> => {
  const { error } = await supabase.rpc("log_prescription_shared", {
    p_prescription_id: prescriptionId,
    p_channel: channel,
  });
  if (error) {
    console.error("[prescriberService] log_prescription_shared failed:", error.code);
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No se pudo registrar el envío de la receta en la Bitácora.",
    );
  }
};
