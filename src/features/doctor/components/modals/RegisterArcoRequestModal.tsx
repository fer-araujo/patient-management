import { useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { ClipboardPlus, Loader2 } from "lucide-react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { fetchPatients } from "../../../../lib/services/patientService";
import {
  staffRegisterArcoRequest,
  type ArcoChannel,
  type ArcoRequestType,
} from "../../../../lib/services/privacyService";
import {
  ARCO_CHANNEL_LABELS,
  ARCO_FORM_TYPES,
  ARCO_TYPE_LABELS,
} from "../../../../lib/legal/arcoLabels";

const LABEL_CLASSES = "text-brand-dark font-bold text-sm mb-2 block";

const TYPE_OPTIONS = ARCO_FORM_TYPES.map((type) => ({
  value: type,
  label: ARCO_TYPE_LABELS[type].title,
}));

const CHANNEL_OPTIONS = (Object.keys(ARCO_CHANNEL_LABELS) as ArcoChannel[]).map(
  (channel) => ({ value: channel, label: ARCO_CHANNEL_LABELS[channel] }),
);

const DETAILS_MIN = 5;
const DETAILS_MAX = 4000;

interface FormProps {
  onClose: () => void;
  onRegistered: () => void;
}

const RegisterArcoRequestForm = ({ onClose, onRegistered }: FormProps) => {
  const [patients, setPatients] = useState<{ value: string; label: string }[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [requestType, setRequestType] = useState<ArcoRequestType | "">("");
  const [channel, setChannel] = useState<ArcoChannel | "">("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPatients()
      .then((rows) => {
        if (!active) return;
        // An anonymized record has no name to match a request against.
        setPatients(
          rows
            .filter((p) => !p.anonymizedAt)
            .map((p) => ({ value: p.id, label: p.name }))
            .sort((a, b) => a.label.localeCompare(b.label, "es")),
        );
      })
      .catch((err: unknown) => {
        console.error(
          "[RegisterArcoRequestModal] patients load failed:",
          err instanceof Error ? err.message : err,
        );
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const clearError = () => setError(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const text = details.trim();
    if (!patientId) return setError("Elige el paciente que hizo la solicitud.");
    if (!requestType) return setError("Elige el tipo de solicitud.");
    if (!channel) return setError("Elige cómo llegó la solicitud.");
    if (text.length < DETAILS_MIN) {
      return setError("Describe brevemente lo que pidió el paciente.");
    }

    setIsSaving(true);
    try {
      await staffRegisterArcoRequest(patientId, requestType, text, channel);
      toast.success("Solicitud registrada. El plazo cuenta desde hoy.");
      onRegistered();
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.message ? err.message : "No se pudo registrar la solicitud.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <div className="space-y-6 pb-2">
        <p role="alert" className="text-base text-brand-gray text-center py-6">
          No se pudo cargar la lista de pacientes. Cierra e inténtalo de nuevo.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          className="w-full min-h-11 py-3.5 rounded-xl cursor-pointer text-base"
        >
          Cerrar
        </Button>
      </div>
    );
  }

  if (patients === null) {
    return (
      <div className="py-12 flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-primary mb-3" />
        <p className="text-base text-brand-gray font-medium">Cargando pacientes...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5 pb-2">
      <p className="text-base text-brand-gray leading-relaxed">
        Para una solicitud que el paciente hizo en persona, por teléfono, por
        correo o por escrito. Queda con fecha de hoy.
      </p>

      <div>
        <span id="arco-register-patient" className={LABEL_CLASSES}>
          Paciente <span className="text-rose-500">*</span>
        </span>
        <Dropdown
          labelledBy="arco-register-patient"
          options={patients}
          value={patientId}
          onChange={(value) => {
            setPatientId(value);
            clearError();
          }}
          placeholder="Buscar paciente..."
          searchable
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <span id="arco-register-type" className={LABEL_CLASSES}>
            Tipo de solicitud <span className="text-rose-500">*</span>
          </span>
          <Dropdown
            labelledBy="arco-register-type"
            options={TYPE_OPTIONS}
            value={requestType}
            onChange={(value) => {
              setRequestType(value as ArcoRequestType);
              clearError();
            }}
            placeholder="Elegir..."
          />
        </div>
        <div>
          <span id="arco-register-channel" className={LABEL_CLASSES}>
            ¿Cómo llegó? <span className="text-rose-500">*</span>
          </span>
          <Dropdown
            labelledBy="arco-register-channel"
            options={CHANNEL_OPTIONS}
            value={channel}
            onChange={(value) => {
              setChannel(value as ArcoChannel);
              clearError();
            }}
            placeholder="Elegir..."
          />
        </div>
      </div>

      <div>
        <label htmlFor="arco-register-details" className={LABEL_CLASSES}>
          ¿Qué pidió? <span className="text-rose-500">*</span>
        </label>
        <textarea
          id="arco-register-details"
          rows={3}
          maxLength={DETAILS_MAX}
          value={details}
          onChange={(e) => {
            setDetails(e.target.value);
            clearError();
          }}
          placeholder="Ej. Pidió por teléfono que se corrija su correo."
          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:border-brand-primary outline-none resize-none"
        />
      </div>

      {error && (
        <p role="alert" className="text-base font-bold text-rose-600">
          {error}
        </p>
      )}

      <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={isSaving}
          className="flex-1 min-h-11 py-3.5 rounded-xl cursor-pointer text-base disabled:opacity-50"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isSaving}
          className="flex-1 min-h-11 py-3.5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md disabled:opacity-50 cursor-pointer text-base font-bold"
        >
          {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          Registrar
        </Button>
      </div>
    </form>
  );
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called once the request is stored (the list should reload). */
  onRegistered: () => void;
}

/**
 * "Registrar solicitud": the doctor records an ARCO request received outside
 * the portal (in doctor-only mode it is the only way in). Mounted fresh on
 * every opening, so no previous answer carries over.
 */
export const RegisterArcoRequestModal = ({ isOpen, onClose, onRegistered }: Props) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Registrar solicitud"
    icon={<ClipboardPlus className="w-5 h-5 text-brand-primary" />}
    hideFooter={true}
  >
    {isOpen && <RegisterArcoRequestForm onClose={onClose} onRegistered={onRegistered} />}
  </Modal>
);
