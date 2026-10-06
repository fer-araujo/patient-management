import { ShieldCheck } from "lucide-react";
import { TouchCheckbox } from "./TouchCheckbox";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The patient already holds a consent for the current notice. */
  alreadySigned?: boolean;
}

/**
 * "El paciente firmó el aviso de privacidad en papel", for the doctor's
 * patient forms. When the patient already consented to the current notice it
 * shows that instead of a checkbox.
 */
export const PaperConsentCheckbox = ({ checked, onChange, alreadySigned = false }: Props) => {
  if (alreadySigned) {
    return (
      <p className="flex items-center gap-3 min-h-11 text-base font-medium text-teal-700">
        <ShieldCheck className="w-5 h-5 shrink-0" strokeWidth={2.5} />
        Aviso de privacidad firmado.
      </p>
    );
  }

  return (
    <TouchCheckbox checked={checked} onChange={onChange}>
      El paciente firmó el aviso de privacidad en papel
    </TouchCheckbox>
  );
};
