import type { ReactNode } from "react";
import { Check } from "lucide-react";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

/**
 * The doctor's checkbox: the same box as the patient's online consent
 * checkbox (PrivacyConsentCheckbox), with a whole-row 44px touch target.
 */
export const TouchCheckbox = ({ checked, onChange, children }: Props) => (
  <label className="flex items-center gap-3 min-h-11 cursor-pointer">
    <span className="relative flex items-center justify-center shrink-0">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`w-6 h-6 rounded border-2 transition-colors flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-brand-primary/30 ${checked ? "bg-brand-primary border-brand-primary" : "bg-white border-brand-light"}`}
      >
        {checked && <Check className="w-4 h-4 text-white" strokeWidth={4} />}
      </span>
    </span>
    <span className="text-base text-brand-dark font-medium leading-snug">{children}</span>
  </label>
);
