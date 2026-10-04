import { Info } from "lucide-react";

/**
 * Mandatory notice wherever prescribed medications are shown or printed.
 *
 * The platform only stores what was prescribed as part of the clinical record.
 * An official prescription under the Reglamento de Insumos para la Salud
 * (arts. 29-30) must carry the prescriber's printed name, address and cédula
 * profesional, the date and a handwritten signature, which this screen does
 * not produce.
 */
export const PrescriptionDisclaimer = ({
  className = "",
}: {
  className?: string;
}) => (
  <div
    role="note"
    className={`flex items-start gap-2 rounded-xl bg-brand-light/60 px-3 py-2 text-xs font-medium text-brand-dark ${className}`}
  >
    <Info className="w-4 h-4 shrink-0 text-brand-primary" aria-hidden="true" />
    <p>Registro informativo del expediente. No es una receta médica oficial.</p>
  </div>
);
