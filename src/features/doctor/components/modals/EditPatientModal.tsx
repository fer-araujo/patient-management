import { useEffect, useState } from "react";
import { Loader2, Save, Edit2, Calendar as CalendarIcon } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../../components/ui/Modal";
import { Input } from "../../../../components/ui/Input";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DatePicker } from "../../../../components/ui/DatePicker";
import { Button } from "../../../../components/ui/Button";
import {
  ANONYMIZED_PATIENT_MESSAGE,
  BLOOD_TYPES,
  PATIENT_GENDERS,
  fetchPatientDetails,
  updatePatientDetails,
  type PatientDetails,
} from "../../../../lib/services/patientService";
import {
  NATIONAL_PHONE_LENGTH,
  PHONE_COUNTRY_OPTIONS,
  canonicalPhone,
  splitStoredPhone,
  toE164Phone,
} from "../../../../lib/phone";
import {
  fetchHasCurrentConsent,
  recordInPersonConsent,
} from "../../../../lib/services/privacyService";
import {
  getWeightTracking,
  setWeightTracking,
} from "../../../../lib/services/bodyMeasurementService";
import { PaperConsentCheckbox } from "../PaperConsentCheckbox";
import { TouchCheckbox } from "../TouchCheckbox";
import { useClinicMode } from "../../../clinicMode/useClinicMode";

const GENDER_OPTIONS = [
  { label: "Sin especificar", value: "" },
  ...PATIENT_GENDERS.map((g) => ({ label: g, value: g })),
];

const BLOOD_TYPE_OPTIONS = [
  ...BLOOD_TYPES.map((t) => ({ label: t.replace("-", "−"), value: t })),
  { label: "No sé", value: "" },
];

interface FormState {
  firstName: string;
  lastName: string;
  countryCode: string;
  phoneNumber: string;
  email: string;
  dob: string;
  gender: string;
  bloodType: string;
  allergies: string;
  chronicConditions: string;
  address: string;
  familyHistory: string;
  personalPathologicalHistory: string;
  nonPathologicalHistory: string;
  currentIllness: string;
}

type HistoryField =
  | "familyHistory"
  | "personalPathologicalHistory"
  | "nonPathologicalHistory"
  | "currentIllness";

/** Clinical history (NOM-004 6.1), in the order of the historia clínica. */
const HISTORY_FIELDS: { key: HistoryField; label: string; placeholder: string }[] = [
  {
    key: "familyHistory",
    label: "Heredofamiliares",
    placeholder: "Ej. Negados",
  },
  {
    key: "personalPathologicalHistory",
    label: "Personales patológicos",
    placeholder: "Ej. Negados",
  },
  {
    key: "nonPathologicalHistory",
    label: "Personales no patológicos",
    placeholder: "Ej. Negados",
  },
  {
    key: "currentIllness",
    label: "Padecimiento actual",
    placeholder: "Ej. Negados",
  },
];

const toFormState = (p: PatientDetails): FormState => {
  const { countryCode, nationalNumber } = splitStoredPhone(p.phone);
  return {
    firstName: p.first_name ?? "",
    lastName: p.last_name ?? "",
    countryCode,
    phoneNumber: nationalNumber,
    email: p.email ?? "",
    dob: p.dob ?? "",
    gender: p.gender ?? "",
    bloodType: p.blood_type ?? "",
    allergies: p.allergies ?? "",
    chronicConditions: p.chronic_conditions ?? "",
    address: p.address ?? "",
    familyHistory: p.family_history ?? "",
    personalPathologicalHistory: p.personal_pathological_history ?? "",
    nonPathologicalHistory: p.non_pathological_history ?? "",
    currentIllness: p.current_illness ?? "",
  };
};

const todayIso = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** "12 de marzo de 1955", built as a local date (not UTC midnight). */
const formatBirthDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const compactInputClasses = "!py-2.5 !px-3 !text-sm !rounded-lg";
const compactLabelClasses =
  "[&>label]:!text-sm [&>label]:!font-bold [&>label]:!mb-0.5";

interface FormProps {
  patientId: string;
  onClose: () => void;
  onSaved: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; patient: PatientDetails };

const EditPatientForm = ({ patientId, onClose, onSaved }: FormProps) => {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [form, setForm] = useState<FormState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDobPickerOpen, setIsDobPickerOpen] = useState(false);
  // Privacy notice signed on paper: null while unknown.
  const [hasConsent, setHasConsent] = useState<boolean | null>(null);
  const [paperConsent, setPaperConsent] = useState(false);
  // "Llevar control de peso": the saved flag (null while unknown or when it
  // cannot be read; then the box is not offered) and the box.
  const [savedWeightTracking, setSavedWeightTracking] = useState<boolean | null>(null);
  const [trackWeight, setTrackWeight] = useState(false);
  // No patient portal in doctor-only mode, so no portal note.
  const { doctorOnlyMode } = useClinicMode();

  useEffect(() => {
    let active = true;
    fetchHasCurrentConsent(patientId)
      .then((signed) => {
        if (active) setHasConsent(signed);
      })
      .catch(() => {
        // Unknown: offer the checkbox; recording is idempotent on the server.
        if (active) setHasConsent(false);
      });
    return () => {
      active = false;
    };
  }, [patientId]);

  // Same read and write as the consultation's weight tab
  // (bodyMeasurementService), so both screens always agree.
  useEffect(() => {
    let active = true;
    getWeightTracking(patientId)
      .then((on) => {
        if (!active) return;
        setSavedWeightTracking(on);
        setTrackWeight(on);
      })
      .catch((err: unknown) => {
        console.error(
          "Error cargando control de peso:",
          err instanceof Error ? err.message : err,
        );
      });
    return () => {
      active = false;
    };
  }, [patientId]);

  useEffect(() => {
    let active = true;
    fetchPatientDetails(patientId)
      .then((patient) => {
        if (!active) return;
        setForm(toFormState(patient));
        setLoad({ status: "ready", patient });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoad({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "No se pudieron cargar los datos del paciente.",
        });
      });
    return () => {
      active = false;
    };
  }, [patientId]);

  const closeButton = (
    <div className="pt-4 mt-2 border-t border-brand-light flex gap-3 justify-end">
      <Button
        type="button"
        variant="outline"
        onClick={onClose}
        className="px-6 py-2.5 cursor-pointer text-sm"
      >
        Cerrar
      </Button>
    </div>
  );

  if (load.status === "loading") {
    return (
      <div className="py-20 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
        <p className="text-brand-gray font-medium">Cargando datos...</p>
      </div>
    );
  }

  if (load.status === "error" || !form) {
    return (
      <>
        <p className="text-center text-brand-gray font-medium py-10">
          {load.status === "error"
            ? load.message
            : "No se pudieron cargar los datos del paciente."}
        </p>
        {closeButton}
      </>
    );
  }

  const { patient } = load;

  if (patient.anonymized_at) {
    return (
      <>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs text-amber-800 leading-relaxed">
            {ANONYMIZED_PATIENT_MESSAGE}
          </p>
        </div>
        {closeButton}
      </>
    );
  }

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  const newPhone = toE164Phone(form.countryCode, form.phoneNumber);
  const typedPhone = form.phoneNumber
    ? (newPhone ?? form.countryCode + form.phoneNumber)
    : "";
  const phoneChanged =
    canonicalPhone(typedPhone) !== canonicalPhone(patient.phone);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.firstName.trim()) {
      toast.error("Escribe el nombre del paciente.");
      return;
    }
    if (!newPhone) {
      const missing = NATIONAL_PHONE_LENGTH - form.phoneNumber.length;
      toast.error(
        missing > 0
          ? `Ingresa un número a 10 dígitos (te falta${missing > 1 ? "n" : ""} ${missing}).`
          : "Ingresa un número a 10 dígitos.",
      );
      return;
    }

    setIsSaving(true);
    try {
      await updatePatientDetails(patientId, {
        first_name: form.firstName,
        last_name: form.lastName,
        phone: newPhone,
        email: form.email,
        gender: form.gender,
        dob: form.dob,
        blood_type: form.bloodType,
        allergies: form.allergies,
        chronic_conditions: form.chronicConditions,
        address: form.address,
        family_history: form.familyHistory,
        personal_pathological_history: form.personalPathologicalHistory,
        non_pathological_history: form.nonPathologicalHistory,
        current_illness: form.currentIllness,
      });
      toast.success("Datos del paciente actualizados");

      // The personal data is saved. A failed step below keeps the form open
      // so the doctor can retry it; the list is refreshed either way.
      let stepFailed = false;
      if (savedWeightTracking !== null && trackWeight !== savedWeightTracking) {
        try {
          await setWeightTracking(patientId, trackWeight);
          setSavedWeightTracking(trackWeight);
        } catch (trackingError: unknown) {
          stepFailed = true;
          toast.error(
            trackingError instanceof Error
              ? trackingError.message
              : "No se pudo cambiar el control de peso.",
          );
        }
      }
      if (paperConsent && !hasConsent) {
        try {
          await recordInPersonConsent(patientId);
          setHasConsent(true);
        } catch (consentError: unknown) {
          stepFailed = true;
          toast.error(
            consentError instanceof Error
              ? consentError.message
              : "No se pudo registrar el aviso de privacidad firmado.",
          );
        }
      }
      // After every step, so the directory's badges show what was recorded.
      onSaved();
      if (!stepFailed) onClose();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudieron guardar los datos del paciente.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Nombre(s)"
          type="text"
          value={form.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
          required
          containerClassName={`w-full ${compactLabelClasses}`}
          className={compactInputClasses}
        />
        <Input
          label="Apellidos"
          type="text"
          value={form.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
          containerClassName={`w-full ${compactLabelClasses}`}
          className={compactInputClasses}
        />
      </div>

      <div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="w-full">
            <label className="text-brand-dark font-bold text-sm mb-2 block">
              País
            </label>
            <Dropdown
              options={PHONE_COUNTRY_OPTIONS}
              value={form.countryCode}
              onChange={(val) => set({ countryCode: val })}
              className="py-0! text-sm!"
            />
          </div>
          <Input
            label="Número celular"
            type="tel"
            placeholder="10 dígitos"
            value={form.phoneNumber}
            onChange={(e) =>
              set({ phoneNumber: e.target.value.replace(/\D/g, "") })
            }
            required
            maxLength={NATIONAL_PHONE_LENGTH}
            containerClassName={`w-full sm:col-span-2 ${compactLabelClasses}`}
            className={compactInputClasses}
          />
        </div>
        {phoneChanged && !doctorOnlyMode && (
          <p className="text-xs text-brand-gray mt-1 flex items-center">
            El paciente entrará a su portal con el nuevo número.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Correo"
          type="email"
          placeholder="correo@ejemplo.com"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
          containerClassName={`w-full ${compactLabelClasses}`}
          className={compactInputClasses}
        />
        {/* The app's DatePicker (same trigger as the calendar's date fields),
            opened on past years since this is a birth date. */}
        <div className="w-full relative">
          <label
            htmlFor="edit-patient-dob"
            className="text-brand-dark font-bold text-sm mb-2 block"
          >
            Fecha de nacimiento
          </label>
          <button
            id="edit-patient-dob"
            type="button"
            onClick={() => setIsDobPickerOpen(true)}
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left transition-all flex items-center justify-between group cursor-pointer"
          >
            <span className={form.dob ? "text-brand-dark" : "text-brand-gray"}>
              {form.dob ? formatBirthDate(form.dob) : "Seleccionar..."}
            </span>
            <CalendarIcon className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
          </button>
          <div className="absolute top-full mt-2 z-50">
            <DatePicker
              isOpen={isDobPickerOpen}
              onClose={() => setIsDobPickerOpen(false)}
              selectedDate={form.dob || null}
              maxDate={todayIso()}
              allowPast
              title="Fecha de nacimiento"
              onSelectDate={(d) => {
                set({ dob: d });
                setIsDobPickerOpen(false);
              }}
            />
          </div>
        </div>
      </div>

      <Input
        label="Domicilio"
        type="text"
        placeholder="Calle, número, colonia y ciudad"
        value={form.address}
        onChange={(e) => set({ address: e.target.value })}
        containerClassName={`w-full ${compactLabelClasses}`}
        className={compactInputClasses}
      />

      {hasConsent !== null && (
        <PaperConsentCheckbox
          checked={paperConsent}
          onChange={setPaperConsent}
          alreadySigned={hasConsent}
        />
      )}

      {savedWeightTracking !== null && (
        <div>
          <TouchCheckbox checked={trackWeight} onChange={setTrackWeight}>
            Llevar control de peso
          </TouchCheckbox>
          {savedWeightTracking && !trackWeight && (
            <p className="text-sm font-medium text-brand-gray mt-1">
              Las mediciones guardadas no se borran.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="w-full">
          <label className="text-brand-dark font-bold text-sm mb-2 block">
            Género
          </label>
          <Dropdown
            options={GENDER_OPTIONS}
            value={form.gender}
            onChange={(val) => set({ gender: val })}
            className="py-0! text-sm!"
          />
        </div>
        <div className="w-full">
          <label className="text-brand-dark font-bold text-sm mb-2 block">
            Tipo de sangre
          </label>
          <Dropdown
            options={BLOOD_TYPE_OPTIONS}
            value={form.bloodType}
            onChange={(val) => set({ bloodType: val })}
            className="py-0! text-sm!"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Alergias"
          type="text"
          placeholder="Ej. Penicilina"
          value={form.allergies}
          onChange={(e) => set({ allergies: e.target.value })}
          containerClassName={`w-full ${compactLabelClasses}`}
          className={compactInputClasses}
        />
        <Input
          label="Enfermedades crónicas"
          type="text"
          placeholder="Ej. Diabetes"
          value={form.chronicConditions}
          onChange={(e) => set({ chronicConditions: e.target.value })}
          containerClassName={`w-full ${compactLabelClasses}`}
          className={compactInputClasses}
        />
      </div>

      <div className="pt-4 mt-2 border-t border-brand-light space-y-4">
        <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest">
          Antecedentes
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {HISTORY_FIELDS.map((field) => (
            <div key={field.key} className="w-full">
              <label
                htmlFor={`edit-patient-${field.key}`}
                className="text-brand-dark font-bold text-sm mb-2 block"
              >
                {field.label}
              </label>
              <textarea
                id={`edit-patient-${field.key}`}
                rows={2}
                placeholder={field.placeholder}
                value={form[field.key]}
                onChange={(e) => set({ [field.key]: e.target.value })}
                className="w-full px-3 py-2.5 border-2 border-brand-light rounded-lg text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all resize-none"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="pt-4 mt-2 border-t border-brand-light flex gap-3 justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          className="px-6 py-2.5 cursor-pointer text-sm"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isSaving}
          className="px-6 py-2.5 flex items-center gap-2 cursor-pointer text-sm disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Guardar Cambios
        </Button>
      </div>
    </form>
  );
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  patientId: string | null;
}

/**
 * Staff edit of a patient's personal data, e.g. to apply an ARCO
 * rectification request. Anonymized records are shown read-only.
 */
export const EditPatientModal = ({
  isOpen,
  onClose,
  onSaved,
  patientId,
}: Props) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Editar datos del paciente"
    icon={<Edit2 className="w-5 h-5 text-brand-primary" />}
    hideFooter={true}
    maxWidth="max-w-2xl"
  >
    {/* Keyed by patient so each opening loads fresh data into a fresh form. */}
    {isOpen && patientId && (
      <EditPatientForm
        key={patientId}
        patientId={patientId}
        onClose={onClose}
        onSaved={onSaved}
      />
    )}
  </Modal>
);
