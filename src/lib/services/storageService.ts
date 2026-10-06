import { supabase } from "../supabase";
import {
  resolveClinicalMimeType,
  validateClinicalFile,
} from "../files/clinicalUploadRules";

export interface ClinicalFile {
  name: string;
  originalName: string;
  url: string;
  isImage: boolean;
  createdAt: string;
}

export type UploadedBy = "doctor" | "patient";

/**
 * Uploads a clinical file and records it in public.patient_files so the upload
 * appears in the audit trail. Staff insert the row directly; patients have no
 * direct table writes and go through the register_my_upload RPC, which checks
 * the object is inside their own folder.
 *
 * Throws a Spanish, user-facing message when the file breaks the bucket rules.
 */
export const uploadPatientFile = async (
  patientId: string,
  file: File,
  uploadedBy: UploadedBy,
): Promise<void> => {
  const validationError = validateClinicalFile(file);
  if (validationError) throw new Error(validationError);

  // Sanitize the original name to avoid problems with spaces or odd characters.
  const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");

  // Path: PATIENT_ID / TIMESTAMP_CLEAN_NAME
  const filePath = `${patientId}/${Date.now()}_${cleanFileName}`;

  const { error } = await supabase.storage
    .from("clinical_records")
    .upload(filePath, file, {
      contentType: resolveClinicalMimeType(file) ?? undefined,
    });
  if (error) throw new Error(`Error subiendo archivo: ${error.message}`);

  // The object already exists at this point. A failed registration is logged
  // but not surfaced: retrying would upload a duplicate file.
  const { error: registerError } =
    uploadedBy === "patient"
      ? await supabase.rpc("register_my_upload", {
          p_object_name: filePath,
          p_file_name: file.name,
        })
      : await supabase.from("patient_files").insert({
          patient_id: patientId,
          file_url: filePath,
          file_name: file.name,
          file_type: resolveClinicalMimeType(file),
          uploaded_by: "doctor",
        });

  if (registerError) {
    console.error(
      "[StorageService] Upload stored but not registered in patient_files:",
      registerError.code,
    );
  }
};

/**
 * Short-lived signed URL that makes the browser save the file (Content-
 * Disposition: attachment) under its original name.
 */
export const getClinicalFileDownloadUrl = async (
  patientId: string,
  storedName: string,
  originalName: string,
): Promise<string> => {
  const { data, error } = await supabase.storage
    .from("clinical_records")
    .createSignedUrl(`${patientId}/${storedName}`, 60, {
      download: originalName,
    });
  if (error || !data?.signedUrl) {
    throw new Error("No se pudo generar el enlace de descarga.");
  }
  return data.signedUrl;
};

/** Storage `list()` returns 100 objects unless told otherwise, so it is paged. */
export const FILES_PAGE_SIZE = 100;
/** Past this many files of one patient the list is refused, never shown partial. */
export const FILES_MAX = 5000;

export const getPatientFiles = async (
  patientId: string,
): Promise<ClinicalFile[]> => {
  type StoredObject = {
    name: string;
    created_at?: string | null;
    metadata?: { mimetype?: string } | null;
  };
  const data: StoredObject[] = [];
  for (let offset = 0; ; offset += FILES_PAGE_SIZE) {
    const { data: page, error } = await supabase.storage
      .from("clinical_records")
      .list(patientId, {
        limit: FILES_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) throw new Error(`Error listando archivos: ${error.message}`);
    const batch = (page ?? []) as StoredObject[];
    data.push(...batch);
    if (data.length > FILES_MAX) {
      throw new Error("El paciente tiene demasiados archivos para mostrarlos.");
    }
    if (batch.length < FILES_PAGE_SIZE) break;
  }
  if (data.length === 0) return [];

  const filesWithUrls = await Promise.all(
    data.map(async (file) => {
      const { data: urlData } = await supabase.storage
        .from("clinical_records")
        .createSignedUrl(`${patientId}/${file.name}`, 3600);

      const originalNameParts = file.name.split("_");
      originalNameParts.shift();
      const originalName = originalNameParts.join("_") || file.name;

      return {
        name: file.name,
        originalName: originalName,
        url: urlData?.signedUrl || "",
        isImage: file.metadata?.mimetype?.startsWith("image/") || false,
        // FIX: Fallback a la fecha actual si Supabase devuelve null
        createdAt: file.created_at || new Date().toISOString(),
      };
    }),
  );

  return filesWithUrls
    .filter((f) => f.url !== "")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
};
