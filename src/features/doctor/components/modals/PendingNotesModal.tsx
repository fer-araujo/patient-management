import { FileText } from "lucide-react";
import { Modal } from "../../../../components/ui/Modal";
import type { DashboardAppointment } from "../../../../lib/services/clinicService";

interface PendingNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Appointments whose note is still open (DashboardAppointment.notePending). */
  appointments: DashboardAppointment[];
  /** Opens the patient's record on that visit's note. */
  onOpenRecord: (appointment: DashboardAppointment) => void;
}

/**
 * "Notas pendientes de cerrar": one row per finalized consultation (or past
 * visit) whose clinical note is still open, oldest first, each with a link to
 * the record where the note is completed and closed.
 */
export const PendingNotesModal = ({
  isOpen,
  onClose,
  appointments,
  onOpenRecord,
}: PendingNotesModalProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Notas pendientes de cerrar"
    icon={<FileText className="w-5 h-5 text-brand-primary" />}
    hideFooter={true}
    maxWidth="max-w-lg"
  >
    <div className="space-y-4 pb-2">
      <p className="text-sm text-brand-gray">
        Consultas finalizadas con la nota clínica abierta. Complétala y ciérrala
        desde el expediente.
      </p>
      {appointments.length === 0 ? (
        <p className="text-sm text-brand-gray italic text-center py-2">
          No hay notas pendientes.
        </p>
      ) : (
        <ul className="space-y-2">
          {appointments.map((appointment) => (
            <li
              key={appointment.id}
              className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-slate-100"
            >
              <div className="min-w-0">
                <p className="font-bold text-brand-dark truncate">
                  {appointment.patientName}
                </p>
                <p className="text-sm font-medium text-slate-500">
                  {appointment.date} · {appointment.time} · {appointment.service}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenRecord(appointment)}
                aria-label={`Abrir expediente de ${appointment.patientName} del ${appointment.date}`}
                className="text-sm font-bold text-brand-primary hover:underline cursor-pointer shrink-0 min-h-11 px-3"
              >
                Abrir expediente
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  </Modal>
);
