/**
 * Client-side mirror of the clinical_records bucket limits set in
 * supabase/migrations/20260922181100_storage_limits.sql. The bucket is the
 * real enforcement; this exists so the patient sees a clear Spanish message
 * before a doomed upload starts.
 */
export const CLINICAL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
};

const ALLOWED_MIME_TYPES = new Set(Object.values(EXTENSION_TO_MIME));

/** Value for the <input type="file" accept> attribute. */
export const CLINICAL_UPLOAD_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic";

export const CLINICAL_UPLOAD_RULES_TEXT =
  "Formatos permitidos: PDF, JPG, PNG o HEIC (fotos de iPhone). Tamaño máximo: 10 MB por archivo.";

const extensionOf = (fileName: string): string =>
  fileName.split(".").pop()?.toLowerCase() ?? "";

/**
 * Content type to send to Storage. Some browsers report HEIC files with an
 * empty type, so the extension is the fallback; an unknown type returns null.
 */
export const resolveClinicalMimeType = (file: File): string | null => {
  if (ALLOWED_MIME_TYPES.has(file.type)) return file.type;
  return EXTENSION_TO_MIME[extensionOf(file.name)] ?? null;
};

/** Returns a Spanish error message, or null when the file is acceptable. */
export const validateClinicalFile = (file: File): string | null => {
  if (!resolveClinicalMimeType(file)) {
    return `El archivo "${file.name}" no se puede subir. ${CLINICAL_UPLOAD_RULES_TEXT}`;
  }
  if (file.size > CLINICAL_UPLOAD_MAX_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return `El archivo "${file.name}" pesa ${sizeMb} MB. El máximo permitido es 10 MB.`;
  }
  if (file.size === 0) {
    return `El archivo "${file.name}" está vacío.`;
  }
  return null;
};
