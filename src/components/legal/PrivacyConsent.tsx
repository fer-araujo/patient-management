import { Check, FileText, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { Modal } from "../ui/Modal";
import { PrivacyPolicyContent } from "./PrivacyPolicyContent";
import { TermsAndConditionsContent } from "./TermsAndConditionsContent";

export type LegalDocument = "privacy" | "terms";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  onOpenDocument: (document: LegalDocument) => void;
}

/**
 * Express consent for sensitive (health) data - LFPDPPP art. 8.
 * Shared by the new-patient registration form and the returning-patient
 * consent step so both show exactly the same wording and markup.
 */
export const PrivacyConsentCheckbox = ({
  checked,
  onChange,
  onOpenDocument,
}: CheckboxProps) => (
  <label className="flex items-start gap-3 cursor-pointer group mt-2">
    <div className="relative flex items-center justify-center shrink-0 mt-0.75">
      <input
        type="checkbox"
        required
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div
        aria-hidden="true"
        className={`w-5 h-5 rounded border-2 transition-colors flex items-center justify-center ${checked ? "bg-brand-primary border-brand-primary" : "bg-white border-brand-light"}`}
      >
        {checked && (
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
      He leído el{" "}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenDocument("privacy");
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
          onOpenDocument("terms");
        }}
        className="text-brand-primary font-bold cursor-pointer hover:underline"
      >
        Términos y Condiciones
      </button>
      , y doy mi consentimiento expreso para que la Dra. Carmen Torres use mis
      datos de salud para atenderme.
    </span>
  </label>
);

interface ModalsProps {
  openDocument: LegalDocument | null;
  onClose: () => void;
}

/**
 * The two legal documents behind the checkbox links. Render it OUTSIDE any
 * animated (transformed) container: Modal is position:fixed without a portal.
 */
export const PrivacyConsentModals = ({ openDocument, onClose }: ModalsProps) => (
  <>
    <Modal
      isOpen={openDocument === "privacy"}
      onClose={onClose}
      title="Aviso de Privacidad"
      icon={<ShieldCheck className="w-6 h-6 text-brand-primary" />}
    >
      <PrivacyPolicyContent />
    </Modal>

    <Modal
      isOpen={openDocument === "terms"}
      onClose={onClose}
      title="Términos y Condiciones de Uso"
      icon={<FileText className="w-6 h-6 text-brand-primary" />}
    >
      <TermsAndConditionsContent />
    </Modal>
  </>
);
