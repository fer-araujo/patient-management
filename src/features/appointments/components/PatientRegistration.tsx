import { useState, useRef } from "react";
import {
  HeartPulse,
  ArrowLeft,
  Upload,
  Check,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Modal } from "../../../components/ui/Modal"; // Importamos el nuevo Modal
import { PrivacyPolicyContent } from "./PrivacyPolicyContent";
import { TermsAndConditionsContent } from "./TermsAndConditionsContent";

interface Props {
  onBack: () => void;
  onSubmit: (data: {
    fullName: string;
    email: string;
    reason: string;
    termsAccepted: boolean;
  }) => void;
}

export const PatientRegistration = ({ onBack, onSubmit }: Props) => {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    reason: "",
    termsAccepted: false,
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<"privacy" | "terms" | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.termsAccepted) return;
    onSubmit(formData);
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
          Vemos que es tu primera vez con nosotros. Completa estos datos para
          crear tu expediente clínico.
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

          <div className="flex flex-col gap-1.5">
            <label className="text-brand-dark font-medium text-base xl:text-lg text-left tracking-normal ml-1">
              Motivo de la consulta
            </label>
            <textarea
              placeholder="Describa brevemente su malestar o tratamiento..."
              value={formData.reason}
              onChange={(e) =>
                setFormData({ ...formData, reason: e.target.value })
              }
              required
              className="w-full px-4 py-3 border-2 border-brand-light rounded-xl text-base xl:text-lg text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all resize-none h-20"
            />
          </div>

          {/* Input mágico para archivos (Compactado) */}
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
                accept="image/*, application/pdf"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <Upload className="w-6 h-6 text-brand-primary mb-2" />
              <p className="text-sm font-bold text-brand-dark">
                {fileName ? fileName : "Toca aquí para subir o tomar foto"}
              </p>
              <p className="text-xs text-brand-gray font-medium mt-1">
                {fileName ? "Archivo adjunto" : "JPG, PNG o PDF"}
              </p>
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer group mt-2">
            <div className="relative flex items-center justify-center shrink-0 mt-0.75">
              {/* Checkbox Oculto para accesibilidad */}
              <input
                type="checkbox"
                className="sr-only"
                checked={formData.termsAccepted}
                onChange={(e) =>
                  setFormData({ ...formData, termsAccepted: e.target.checked })
                }
              />
              {/* Checkbox Visual - AHORA CON RENDERIZADO CONDICIONAL DE REACT */}
              <div
                className={`w-5 h-5 rounded border-2 transition-colors flex items-center justify-center ${formData.termsAccepted ? "bg-brand-primary border-brand-primary" : "bg-white border-brand-light"}`}
              >
                {formData.termsAccepted && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Check className="w-3.5 h-3.5 text-white" strokeWidth={4} />
                  </motion.div>
                )}
              </div>
            </div>
            <span className="text-[13px] text-brand-gray font-medium leading-relaxed">
              He leído y acepto el{" "}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveModal("privacy");
                }}
                className="text-brand-primary font-bold cursor-pointer hover:underline"
              >
                Aviso de Privacidad
              </button>{" "}
              y los{" "}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveModal("terms");
                }}
                className="text-brand-primary font-bold cursor-pointer hover:underline"
              >
                Términos y Condiciones
              </button>{" "}
              de la clínica.
            </span>
          </label>

          <div className="pt-2">
            <Button
              type="submit"
              disabled={
                !formData.fullName ||
                !formData.reason ||
                !formData.termsAccepted
              }
              className="w-full sm:w-fit px-10 py-3 rounded-full text-lg disabled:opacity-50 transition-all"
            >
              Crear Expediente
            </Button>
          </div>
        </form>
      </motion.div>

      <Modal
        isOpen={activeModal === "privacy"}
        onClose={() => setActiveModal(null)}
        title="Aviso de Privacidad"
        icon={<ShieldCheck className="w-6 h-6 text-brand-primary" />}
      >
        <PrivacyPolicyContent />
      </Modal>

      <Modal
        isOpen={activeModal === "terms"}
        onClose={() => setActiveModal(null)}
        title="Términos y Condiciones de Uso"
        icon={<FileText className="w-6 h-6 text-brand-primary" />}
      >
        <TermsAndConditionsContent />
      </Modal>
    </>
  );
};
