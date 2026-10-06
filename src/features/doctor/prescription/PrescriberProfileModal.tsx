import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, FileSignature, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import {
  EMPTY_PRESCRIBER_PROFILE,
  downloadSignature,
  fetchPrescriberProfile,
  savePrescriberProfile,
  uploadSignature,
  type PrescriberProfile,
  type PrescriberProfileFields,
} from "../../../lib/services/prescriberService";
import {
  PRESCRIBER_LIMITS,
  missingPrescriberItems,
  validatePrescriberFields,
  type PrescriberFieldErrors,
} from "./prescriberProfile";
import { SignaturePad } from "./SignaturePad";

const INPUT_CLASSES =
  "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:border-brand-primary outline-none";
const LABEL_CLASSES = "text-brand-dark font-bold text-base mb-2 block";
const SECTION_TITLE_CLASSES = "text-xs font-black text-brand-gray uppercase tracking-widest";

const FIELDS: {
  key: keyof PrescriberProfileFields;
  label: string;
  placeholder: string;
  required?: boolean;
  inputMode?: "numeric" | "tel";
  multiline?: boolean;
}[] = [
  { key: "fullName", label: "Nombre completo", placeholder: "Ej. Dra. Carmen Torres Núñez", required: true },
  { key: "cedulaProfesional", label: "Cédula profesional", placeholder: "Solo números", required: true, inputMode: "numeric" },
  { key: "especialidad", label: "Especialidad", placeholder: "Opcional. Ej. Dermatología" },
  { key: "cedulaEspecialidad", label: "Cédula de especialidad", placeholder: "Opcional. Solo números", inputMode: "numeric" },
  { key: "institucionTitulo", label: "Institución que expidió el título", placeholder: "Ej. Universidad Autónoma de Nuevo León", required: true },
  { key: "consultorioDomicilio", label: "Domicilio del consultorio", placeholder: "Calle, número, colonia, ciudad", required: true, multiline: true },
  { key: "telefono", label: "Teléfono", placeholder: "Opcional. Ej. 81 1234 5678", inputMode: "tel" },
];

const toFields = (profile: PrescriberProfile): PrescriberProfileFields => ({
  fullName: profile.fullName,
  cedulaProfesional: profile.cedulaProfesional,
  especialidad: profile.especialidad,
  cedulaEspecialidad: profile.cedulaEspecialidad,
  institucionTitulo: profile.institucionTitulo,
  consultorioDomicilio: profile.consultorioDomicilio,
  telefono: profile.telefono,
});

interface PrescriberProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the saved profile after every successful save. */
  onSaved?: (profile: PrescriberProfile) => void;
}

/**
 * "Datos de la receta": the doctor's printed data for official prescriptions
 * (RIS art. 29) and her signature, drawn once on the iPad. Mount it only
 * while open, so every opening reads the saved data again.
 */
export const PrescriberProfileModal = ({ isOpen, onClose, onSaved }: PrescriberProfileModalProps) => {
  const [profile, setProfile] = useState<PrescriberProfile>(EMPTY_PRESCRIBER_PROFILE);
  const [fields, setFields] = useState<PrescriberProfileFields>(toFields(EMPTY_PRESCRIBER_PROFILE));
  const [errors, setErrors] = useState<PrescriberFieldErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // onSaved is reported from the profile state itself (after a save), so a
  // text save and a signature save that overlap never report stale data.
  const hasSaved = useRef(false);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });
  useEffect(() => {
    if (hasSaved.current) onSavedRef.current?.(profile);
  }, [profile]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const saved = await fetchPrescriberProfile();
        if (!active) return;
        setProfile(saved);
        setFields(toFields(saved));
      } catch (err: unknown) {
        if (active)
          setLoadError(err instanceof Error ? err.message : "No se pudieron cargar los datos.");
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retryLoad = () => {
    setIsLoading(true);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  };

  // Preview of the current signature version (authenticated download, local
  // URL). A new version has a new path, so the preview is read again.
  useEffect(() => {
    if (!profile.signaturePath) return;
    let active = true;
    let url: string | null = null;
    downloadSignature(profile.signaturePath)
      .then((blob) => {
        if (!active || !blob) return;
        url = URL.createObjectURL(blob);
        setSignatureUrl(url);
      })
      .catch(() => {
        // The preview is optional; the missing-data card still says "Firma".
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
      setSignatureUrl(null);
    };
  }, [profile.signaturePath]);

  const setField = (key: keyof PrescriberProfileFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const found = validatePrescriberFields(fields);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setIsSaving(true);
    try {
      await savePrescriberProfile(fields);
      hasSaved.current = true;
      setProfile((prev) => ({ ...prev, ...fields }));
      toast.success("Datos de la receta guardados.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "No se pudieron guardar los datos.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignature = async (png: Blob) => {
    const signaturePath = await uploadSignature(png);
    hasSaved.current = true;
    setProfile((prev) => ({ ...prev, hasSignature: true, signaturePath }));
    toast.success("Firma guardada.");
  };

  // Text the doctor typed but did not save yet counts as missing.
  const missing = missingPrescriberItems(profile);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSaving) onClose();
      }}
      title="Datos de la receta"
      icon={<FileSignature className="w-6 h-6 text-brand-primary" />}
      hideFooter={true}
    >
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-8 h-8 animate-spin text-brand-primary" aria-label="Cargando" />
        </div>
      ) : loadError ? (
        <div className="space-y-4 text-center">
          <p role="alert" className="text-base font-medium text-rose-600">
            {loadError}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={retryLoad}
            className="min-h-11 py-3.5 rounded-xl cursor-pointer text-base"
          >
            Reintentar
          </Button>
        </div>
      ) : (
        <div className="space-y-6 pb-2">
          {missing.length > 0 ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-base text-amber-800"
            >
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold">Faltan datos para emitir recetas:</p>
                <p>{missing.join(", ")}.</p>
              </div>
            </div>
          ) : (
            <p role="status" className="rounded-xl bg-brand-light/60 px-4 py-3 text-base font-medium text-brand-dark">
              Tus datos están completos. Ya puedes enviar recetas en PDF.
            </p>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <p className={SECTION_TITLE_CLASSES}>Datos impresos en la receta</p>
            {FIELDS.map(({ key, label, placeholder, required, inputMode, multiline }) => (
              <div key={key}>
                <label htmlFor={`prescriber-${key}`} className={LABEL_CLASSES}>
                  {label}
                  {required && <span className="text-rose-500"> *</span>}
                </label>
                {multiline ? (
                  <textarea
                    id={`prescriber-${key}`}
                    rows={2}
                    maxLength={PRESCRIBER_LIMITS[key]}
                    value={fields[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    placeholder={placeholder}
                    aria-invalid={!!errors[key]}
                    className={`${INPUT_CLASSES} resize-none`}
                  />
                ) : (
                  <input
                    id={`prescriber-${key}`}
                    type="text"
                    inputMode={inputMode}
                    autoComplete="off"
                    maxLength={PRESCRIBER_LIMITS[key]}
                    value={fields[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    placeholder={placeholder}
                    aria-invalid={!!errors[key]}
                    className={INPUT_CLASSES}
                  />
                )}
                {errors[key] && (
                  <p role="alert" className="text-base font-medium text-rose-600 mt-1">
                    {errors[key]}
                  </p>
                )}
              </div>
            ))}
            <Button
              type="submit"
              disabled={isSaving}
              className="min-h-11 py-4 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md disabled:opacity-50 cursor-pointer text-base font-bold"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar datos
            </Button>
          </form>

          <section aria-label="Firma" className="space-y-3 pt-4 border-t border-slate-100">
            <p className={SECTION_TITLE_CLASSES}>Firma</p>
            {profile.hasSignature ? (
              <div className="space-y-2">
                {signatureUrl ? (
                  <img
                    src={signatureUrl}
                    alt="Firma guardada"
                    className="max-h-24 bg-white border border-slate-200 rounded-xl p-2"
                  />
                ) : (
                  <p className="text-base text-brand-gray">Firma guardada.</p>
                )}
                <p className="text-base text-brand-gray">
                  Para cambiarla, dibuja una nueva abajo y toca «Guardar firma».
                  Las recetas ya emitidas conservan la firma con la que se emitieron.
                </p>
              </div>
            ) : (
              <p className="text-base text-brand-gray">
                Dibuja tu firma una sola vez. Se imprimirá en cada receta.
              </p>
            )}
            <SignaturePad onSave={handleSignature} />
            <p className="text-sm text-brand-gray">
              La firma dibujada es una firma electrónica simple ligada a tu cuenta.
              Algunas farmacias pueden pedir la receta impresa y firmada a mano
              (por ejemplo, para antibióticos).
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
};
