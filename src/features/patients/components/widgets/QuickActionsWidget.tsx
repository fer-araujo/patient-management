import { useRef, useState } from "react";
import {
  Upload,
  Leaf,
  FileText,
  ChevronRight,
  FolderLock,
  Loader2,
  ArrowLeft,
  Download,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  getClinicalFileDownloadUrl,
  getPatientFiles,
  type ClinicalFile,
} from "../../../../lib/services/storageService";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
import { PrivacyRightsCard } from "./PrivacyRightsCard";
import {
  CLINICAL_UPLOAD_ACCEPT,
  CLINICAL_UPLOAD_RULES_TEXT,
} from "../../../../lib/files/clinicalUploadRules";

interface QuickActionsProps {
  patientId: string;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenCareGuide: () => void;
  onOpenRecipe: () => void;
}

const isPdf = (file: ClinicalFile): boolean =>
  file.name.toLowerCase().endsWith(".pdf");

const formatFileDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export const QuickActionsWidget = ({
  patientId,
  onFileUpload,
  onOpenCareGuide,
  onOpenRecipe,
}: QuickActionsProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Uploaded studies become part of the clinical record and the patient
  // cannot delete them (NOM-004), so that is explained BEFORE the file picker.
  const [isUploadInfoOpen, setIsUploadInfoOpen] = useState(false);
  const [files, setFiles] = useState<ClinicalFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [viewing, setViewing] = useState<ClinicalFile | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const closeStudies = () => {
    setIsUploadInfoOpen(false);
    setViewing(null);
  };

  const viewFile = (file: ClinicalFile) => {
    setPreviewFailed(false);
    setViewing(file);
  };

  const handleDownload = async (file: ClinicalFile) => {
    setIsDownloading(true);
    try {
      // The signed URL carries Content-Disposition: attachment, so the
      // browser saves the file instead of navigating away.
      window.location.assign(
        await getClinicalFileDownloadUrl(patientId, file.name, file.originalName),
      );
    } catch (err) {
      console.error("[QuickActionsWidget] download failed:", err);
      toast.error("No se pudo descargar el archivo.");
    } finally {
      setIsDownloading(false);
    }
  };

  // Signed URLs expire after an hour, so the list is fetched each time the
  // modal opens instead of once on mount.
  const openStudies = async () => {
    setIsUploadInfoOpen(true);
    setIsLoadingFiles(true);
    try {
      setFiles(await getPatientFiles(patientId));
    } catch (err) {
      console.error("[QuickActionsWidget] list files failed:", err);
      setFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleChooseFile = () => {
    closeStudies();
    fileInputRef.current?.click();
  };

  return (
    <>
      {/* Kept outside the card: a programmatic click on an input nested in the
          card would bubble up and reopen the explanation modal. */}
      <input
        type="file"
        accept={CLINICAL_UPLOAD_ACCEPT}
        className="hidden"
        ref={fileInputRef}
        onChange={onFileUpload}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 1. ESTUDIOS - Premium Horizontal */}
        <div
          onClick={openStudies}
          className="cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-teal-200 transition-all group"
        >
          {/* FIX: Contenedor cuadrado w-12 h-12 */}
          <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <Upload className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">
              Estudios
            </h3>
            <p className="text-[12px] text-brand-gray font-medium leading-tight">
              Ver y subir laboratorios
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-teal-500 transition-colors shrink-0" />
        </div>

        {/* 2. MI RECETA - Premium Horizontal */}
        <div
          onClick={onOpenRecipe}
          className="cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-indigo-200 transition-all group"
        >
          {/* FIX: Contenedor cuadrado w-12 h-12 */}
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <FileText className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">
              Mis Medicamentos
            </h3>
            <p className="text-[12px] text-brand-gray font-medium leading-tight">
              Indicados por la doctora
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
        </div>

        {/* 3. CUIDADOS - Premium Horizontal */}
        <div
          onClick={onOpenCareGuide}
          className="cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-violet-200 transition-all group"
        >
          {/* FIX: Contenedor cuadrado w-12 h-12 */}
          <div className="w-12 h-12 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <Leaf className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">
              Cuidados
            </h3>
            <p className="text-[12px] text-brand-gray font-medium leading-tight">
              Post-tratamiento
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-violet-500 transition-colors shrink-0" />
        </div>

        {/* 4. MIS DATOS - ARCO rights (download / request a change) */}
        <PrivacyRightsCard />
      </div>

      <Modal
        isOpen={isUploadInfoOpen}
        onClose={closeStudies}
        title="Mis estudios"
        icon={<FolderLock className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
        maxWidth={viewing ? "max-w-3xl" : "max-w-md"}
      >
        {viewing ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setViewing(null)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-gray hover:text-brand-primary cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Volver
              </button>
              <p className="text-sm font-semibold text-brand-dark truncate">
                {viewing.originalName}
              </p>
            </div>

            {viewing.isImage && !previewFailed ? (
              <img
                src={viewing.url}
                alt={viewing.originalName}
                onError={() => setPreviewFailed(true)}
                className="w-full max-h-[55vh] object-contain rounded-xl bg-slate-50"
              />
            ) : isPdf(viewing) && !previewFailed ? (
              <iframe
                src={viewing.url}
                title={viewing.originalName}
                className="w-full h-[55vh] rounded-xl border border-brand-light bg-slate-50"
              />
            ) : (
              <div className="rounded-xl bg-slate-50 py-10 flex flex-col items-center gap-2 text-center">
                <FileText className="w-8 h-8 text-brand-primary" />
                <p className="text-sm text-brand-gray">
                  Vista previa no disponible. Descarga el archivo para verlo.
                </p>
              </div>
            )}

            <Button
              type="button"
              onClick={() => handleDownload(viewing)}
              disabled={isDownloading}
              className="disabled:opacity-60"
            >
              {isDownloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Descargar
            </Button>
          </div>
        ) : (
        <div className="space-y-4">
          {isLoadingFiles ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
            </div>
          ) : files.length === 0 ? (
            <p className="text-sm text-brand-gray">Aún no has subido estudios.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {files.map((f) => (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => viewFile(f)}
                    className="w-full text-left cursor-pointer flex items-center gap-3 bg-white border-2 border-brand-light rounded-xl p-2 hover:border-brand-primary/40 transition-all"
                  >
                    {f.isImage ? (
                      <img
                        src={f.url}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover shrink-0 bg-slate-50"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-brand-light text-brand-primary rounded-lg flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" strokeWidth={2.5} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-brand-dark truncate">
                        {f.originalName}
                      </p>
                      <p className="text-xs text-brand-gray">
                        {formatFileDate(f.createdAt)}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-slate-100" />
          <p className="text-sm text-brand-gray leading-relaxed">
            Los estudios que subas{" "}
            <strong className="text-brand-dark">
              pasan a formar parte de tu expediente clínico
            </strong>{" "}
            y la doctora podrá verlos en tu próxima consulta.
          </p>
          <p className="rounded-xl bg-brand-light/60 px-3 py-2 text-xs text-brand-dark leading-relaxed">
            Una vez subido, no podrás borrar el archivo. Si subiste algo por
            error, avísale a la clínica.
          </p>
          <p className="text-xs text-brand-gray">{CLINICAL_UPLOAD_RULES_TEXT}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" variant="outline" onClick={closeStudies}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleChooseFile}>
              <Upload className="w-4 h-4" />
              Subir estudio
            </Button>
          </div>
        </div>
        )}
      </Modal>

      {/* =========================================================
          TODO: MVP Fase 2 - Facturación
          ========================================================= */}
      {/* <div className="cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-blue-200 transition-all mt-4 group">
        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
          <Receipt className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div className="flex-1 text-left">
          <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">Solicitar Factura</h3>
          <p className="text-[12px] text-brand-gray font-medium leading-tight">De tu última cita</p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
      </div> */}
    </>
  );
};