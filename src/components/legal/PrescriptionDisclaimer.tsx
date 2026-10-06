import { Info } from "lucide-react";

/**
 * Notice wherever prescribed medications are shown.
 *
 * Since migration 25 a FINALIZED prescription can be issued as an official
 * PDF (Reglamento de Insumos para la Salud, art. 29: printed name, address
 * and cédula of the prescriber, date and signature) from the doctor's
 * "Recetas e Indicaciones" tab. The screens themselves are the clinical
 * record, not the prescription:
 *   - "doctor": how the official PDF is issued, and that controlled
 *     substances (Grupos I-III) must never be prescribed here;
 *   - "patient": the list is a record; the official prescription is the PDF
 *     the doctor sends.
 */
export const PrescriptionDisclaimer = ({
  className = "",
  variant = "doctor",
}: {
  className?: string;
  variant?: "doctor" | "patient";
}) => (
  <div
    role="note"
    className={`flex items-start gap-2 rounded-xl bg-brand-light/60 px-3 py-2 text-xs font-medium text-brand-dark ${className}`}
  >
    <Info className="w-4 h-4 shrink-0 text-brand-primary" aria-hidden="true" />
    {variant === "patient" ? (
      <p>
        Registro de tus medicamentos. Tu receta oficial es el PDF firmado que te
        envía la doctora.
      </p>
    ) : (
      <p>
        Al finalizar la consulta, la receta se puede emitir en PDF con tus datos
        y tu firma. No recetes aquí medicamentos controlados (Grupos I a III).
      </p>
    )}
  </div>
);
