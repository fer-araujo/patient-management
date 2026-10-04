import { useState } from "react";
import { HeartPulse, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../../../components/ui/Button";
import {
  PrivacyConsentCheckbox,
  PrivacyConsentModals,
  type LegalDocument,
} from "../../../components/legal/PrivacyConsent";
import { PRIVACY_NOTICE_VERSION } from "../../../lib/legal/privacyNotice";

interface Props {
  firstName: string | null;
  isSubmitting?: boolean;
  onBack: () => void;
  /** Receives the notice version that was on screen when the box was ticked. */
  onSubmit: (privacyNoticeVersion: string) => void;
}

/**
 * Returning patient without consent for the current privacy notice: shows ONLY
 * the consent checkbox (same markup as the registration form) before booking.
 */
export const PrivacyConsentStep = ({
  firstName,
  isSubmitting = false,
  onBack,
  onSubmit,
}: Props) => {
  const [accepted, setAccepted] = useState(false);
  const [activeModal, setActiveModal] = useState<LegalDocument | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accepted || isSubmitting) return;
    onSubmit(PRIVACY_NOTICE_VERSION);
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
              Aviso de Privacidad
            </p>
          </div>
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-brand-dark mb-3 leading-tight tracking-tight">
          {firstName ? `Hola, ${firstName}.` : "Hola de nuevo."}
        </h1>

        <p className="text-base xl:text-lg text-brand-gray/80 font-medium mb-6 max-w-md leading-relaxed">
          Antes de agendar tu cita, lee y acepta nuestro Aviso de Privacidad.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 xl:space-y-5">
          <PrivacyConsentCheckbox
            checked={accepted}
            onChange={setAccepted}
            onOpenDocument={setActiveModal}
          />

          <div className="pt-2">
            <Button
              type="submit"
              disabled={!accepted || isSubmitting}
              className="w-full sm:w-fit px-10 py-3 rounded-full text-lg disabled:opacity-50 transition-all cursor-pointer"
            >
              Continuar
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
