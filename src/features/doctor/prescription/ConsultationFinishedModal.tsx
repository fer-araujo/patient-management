import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import type { Prescription } from "../../../lib/services/soapService";
import { PrescriptionPdfActions, type PrescriptionPatient } from "./PrescriptionPdfActions";

interface ConsultationFinishedModalProps {
  prescription: Prescription | null;
  patient: PrescriptionPatient;
  /** False for an anonymized patient: no PDF may leave the app. */
  canSend: boolean;
  /** "Listo": back to the dashboard. */
  onDone: () => void;
}

/**
 * Shown right after "Finalizar Consulta" when the consultation has a
 * prescription, so it can be sent or printed without reopening the record.
 */
export const ConsultationFinishedModal = ({
  prescription,
  patient,
  canSend,
  onDone,
}: ConsultationFinishedModalProps) => {
  // The folio exists only once the server issued the prescription (first
  // "Ver / imprimir" or "Enviar por WhatsApp").
  const [folio, setFolio] = useState<string | null>(null);

  return (
    <Modal
      isOpen={prescription !== null}
      onClose={onDone}
      title="Consulta finalizada"
      icon={<CheckCircle2 className="w-6 h-6 text-brand-primary" />}
      hideFooter={true}
    >
      {prescription && (
        <div className="space-y-5 pb-2">
          <p className="text-base text-brand-dark leading-relaxed">
            La consulta de {patient.name} quedó guardada.
          </p>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
            <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest">
              Receta{folio ? ` · Folio ${folio}` : ""}
            </h4>
            <ul className="list-disc pl-5 text-base text-brand-dark space-y-1">
              {prescription.medications.map((med, index) => (
                <li key={`${med.nombre}-${index}`}>{med.nombre}</li>
              ))}
            </ul>
            {canSend && (
              <PrescriptionPdfActions
                prescription={prescription}
                patient={patient}
                onIssued={setFolio}
              />
            )}
          </div>
          <div className="pt-4 border-t border-slate-100 flex">
            <Button
              type="button"
              onClick={onDone}
              className="flex-1 min-h-11 py-3.5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md cursor-pointer font-bold text-base"
            >
              Listo
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
