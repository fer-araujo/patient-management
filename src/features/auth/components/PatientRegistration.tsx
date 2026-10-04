import { useState, useRef } from "react";
import {
  HeartPulse,
  ArrowLeft,
  Upload,
  Users, // <-- Añadimos este icono
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import {
  PrivacyConsentCheckbox,
  PrivacyConsentModals,
  type LegalDocument,
} from "../../../components/legal/PrivacyConsent";
import { PRIVACY_NOTICE_VERSION } from "../../../lib/legal/privacyNotice";
import toast from "react-hot-toast";
import {
  CLINICAL_UPLOAD_ACCEPT,
  validateClinicalFile,
} from "../../../lib/files/clinicalUploadRules";

export interface PatientRegistrationData {
  fullName: string;
  birthYear: string;
  email: string;
  referredBy: string;
  termsAccepted: boolean;
  privacyNoticeVersion: string;
  /** Optional study uploaded right after the patient record is created. */
  file: File | null;
}

interface Props {
  isSubmitting?: boolean;
  onBack: () => void;
  onSubmit: (data: PatientRegistrationData) => void;
}

export const PatientRegistration = ({
  isSubmitting = false,
  onBack,
  onSubmit,
}: Props) => {
  const [formData, setFormData] = useState({
    fullName: "",
    birthYear: "",
    email: "",
    referredBy: "",
    termsAccepted: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [activeModal, setActiveModal] = useState<LegalDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const problem = validateClinicalFile(selected);
    if (problem) {
      toast.error(problem);
      e.target.value = "";
      return;
    }
    setFile(selected);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.termsAccepted || isSubmitting) return;
    // The version travels with the submission so the server records exactly
    // which notice was on screen when the box was ticked.
    onSubmit({
      ...formData,
      file,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.4 }}
        className="max-w-xl w-full mx-auto lg:mx-0"
      >
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={onBack}
            className="w-10 h-10 cursor-pointer rounded-full bg-brand-light/40 flex items-center justify-center text-brand-primary hover:bg-brand-light/70 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
          </button>
          <div className="inline-flex items-center gap-2.5 px-3 py-1.5 bg-brand-light/50 rounded-full border border-brand-light">
            <div className="bg-white p-1 rounded-full shadow-sm text-brand-primary">
              <HeartPulse className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
            <p className="text-[11px] font-bold text-brand-dark tracking-wider uppercase pr-1">
              Nuevo Expediente
            </p>
          </div>
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-brand-dark mb-3 leading-tight tracking-tight">
          Bienvenido.
        </h1>

        <p className="text-base xl:text-lg text-brand-gray/80 font-medium mb-6 max-w-md leading-relaxed">
          Completa estos datos para crear tu expediente y agendar tu
          cita.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 xl:space-y-5">
          <Input
            label="Nombre Completo"
            type="text"
            placeholder="Ej. María López García"
            value={formData.fullName}
            onChange={(e) =>
              setFormData({ ...formData, fullName: e.target.value })
            }
            required
            containerClassName="w-full"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:gap-5">
            <div className="relative">
              <Input
                label="Año de Nacimiento"
                type="text"
                placeholder="Ej. 1975"
                value={formData.birthYear}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    birthYear: e.target.value.replace(/\D/g, "").slice(0, 4),
                  })
                }
                required
                containerClassName="w-full"
              />
            </div>

            <Input
              label="Correo Electrónico (Opcional)"
              type="email"
              placeholder="ejemplo@correo.com"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              containerClassName="w-full"
            />
          </div>

          {/* ¿Quién te refirió? */}
          <div className="space-y-2">
            <label
              htmlFor="referredBy"
              className="block text-brand-dark font-medium text-base xl:text-lg text-left tracking-normal ml-1"
            >
              ¿Quién te refirió con nosotros?{" "}
              <span className="text-brand-gray/50 font-normal text-sm">
                (Opcional)
              </span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Users className="h-5 w-5 text-brand-gray/40" />
              </div>
              <input
                type="text"
                id="referredBy"
                name="referredBy"
                placeholder="El nombre de un amig@"
                value={formData.referredBy}
                onChange={(e) =>
                  setFormData({ ...formData, referredBy: e.target.value })
                }
                className="w-full pl-11 pr-4 py-3 border-2 border-brand-light rounded-xl text-base xl:text-lg text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-brand-dark font-medium text-base xl:text-lg text-left tracking-normal ml-1">
              Estudios o Fotos (Opcional)
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-brand-primary/30 rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-brand-light/30 transition-colors"
            >
              <input
                type="file"
                accept={CLINICAL_UPLOAD_ACCEPT}
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <Upload className="w-6 h-6 text-brand-primary mb-2" />
              <p className="text-sm font-bold text-brand-dark">
                {file ? file.name : "Toca aquí para subir o tomar foto"}
              </p>
              <p className="text-xs text-brand-gray font-medium mt-1">
                {file ? "Archivo adjunto" : "JPG, PNG o PDF"}
              </p>
            </div>
          </div>

          {/* Express consent for sensitive (health) data - LFPDPPP art. 8.
              Required: the submit button stays disabled until it is ticked. */}
          <PrivacyConsentCheckbox
            checked={formData.termsAccepted}
            onChange={(termsAccepted) =>
              setFormData({ ...formData, termsAccepted })
            }
            onOpenDocument={setActiveModal}
          />

          <div className="pt-2">
            <Button
              type="submit"
              disabled={
                !formData.fullName ||
                formData.birthYear.length < 4 ||
                !formData.termsAccepted ||
                isSubmitting
              }
              className="w-full sm:w-fit px-10 py-3 rounded-full text-lg disabled:opacity-50 transition-all cursor-pointer"
            >
              Crear Expediente
            </Button>
          </div>
        </form>
      </motion.div>

      <PrivacyConsentModals
        openDocument={activeModal}
        onClose={() => setActiveModal(null)}
      />
    </>
  );
};
