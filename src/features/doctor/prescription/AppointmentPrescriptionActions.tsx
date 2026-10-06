import { useEffect, useState } from "react";
import {
  fetchFinalizedPrescription,
  type Prescription,
} from "../../../lib/services/soapService";
import { fetchPatientDetails } from "../../../lib/services/patientService";
import { PrescriptionPdfActions, type PrescriptionPatient } from "./PrescriptionPdfActions";

interface AppointmentPrescriptionActionsProps {
  appointmentId: string;
  patientId: string;
  patientName: string;
  phone?: string | null;
}

/**
 * "Receta: Enviar por WhatsApp / Ver" for a completed appointment, so the
 * prescription can be sent again without opening the patient's record.
 * Renders nothing while loading, when the consultation has no finalized
 * prescription, or when the patient was anonymized.
 */
export const AppointmentPrescriptionActions = ({
  appointmentId,
  patientId,
  patientName,
  phone,
}: AppointmentPrescriptionActionsProps) => {
  const [loaded, setLoaded] = useState<{
    prescription: Prescription;
    patient: PrescriptionPatient;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const prescription = await fetchFinalizedPrescription(appointmentId);
      if (!active || !prescription || prescription.medications.length === 0) return;
      // The PDF prints the patient's age and sex.
      const details = await fetchPatientDetails(patientId);
      if (!active || details.anonymized_at) return;
      setLoaded({
        prescription,
        patient: {
          name: patientName,
          dob: details.dob,
          sex: details.gender,
          phone: details.phone ?? phone,
        },
      });
    };
    load().catch((err: unknown) => {
      console.error(
        "[AppointmentPrescriptionActions] Error al cargar la receta:",
        err instanceof Error ? err.message : err,
      );
    });
    return () => {
      active = false;
    };
  }, [appointmentId, patientId, patientName, phone]);

  if (!loaded) return null;

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
      <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest mb-2">
        Receta
      </h4>
      <PrescriptionPdfActions prescription={loaded.prescription} patient={loaded.patient} />
    </div>
  );
};
