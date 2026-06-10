import { supabase } from "../supabase";

export interface ClinicalFile {
  name: string;
  originalName: string;
  url: string;
  isImage: boolean;
  createdAt: string;
}

export const uploadPatientFile = async (
  patientId: string,
  file: File,
): Promise<void> => {
  // Limpiamos el nombre original para evitar problemas con espacios o caracteres raros
  const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");

  // Guardamos en la ruta: ID_DEL_PACIENTE / TIEMPO_NOMBRE_LIMPIO
  const filePath = `${patientId}/${Date.now()}_${cleanFileName}`;

  const { error } = await supabase.storage
    .from("clinical_records")
    .upload(filePath, file);
  if (error) throw new Error(`Error subiendo archivo: ${error.message}`);
};

export const getPatientFiles = async (
  patientId: string,
): Promise<ClinicalFile[]> => {
  const { data, error } = await supabase.storage
    .from("clinical_records")
    .list(patientId);

  if (error) throw new Error(`Error listando archivos: ${error.message}`);
  if (!data || data.length === 0) return [];

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
