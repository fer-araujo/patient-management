import { useState } from "react";
import { UserPlus, Calendar as CalendarIcon } from "lucide-react";
import { toast } from "react-hot-toast/headless";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DatePicker } from "../../../../components/ui/DatePicker";
import {
  BLOOD_TYPES,
  createPatient,
  PATIENT_GENDERS,
} from "../../../../lib/services/patientService";
import { recordInPersonConsent } from "../../../../lib/services/privacyService";
import { PaperConsentCheckbox } from "../PaperConsentCheckbox";

const GENDER_OPTIONS = [
  { label: "Sin especificar", value: "" },
  ...PATIENT_GENDERS.map((g) => ({ label: g, value: g })),
];

/** Same list as "Editar datos": stored with an ASCII minus, shown with a typographic one. */
const BLOOD_TYPE_OPTIONS = [
  ...BLOOD_TYPES.map((t) => ({ label: t.replace("-", "−"), value: t })),
  { label: "No sé", value: "" },
];

const EMPTY_NEW_PATIENT = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  dob: "",
  gender: "",
  bloodType: "",
  allergies: "",
  chronicConditions: "",
  familyHistory: "",
  personalPathologicalHistory: "",
  nonPathologicalHistory: "",
  currentIllness: "",
};

type HistoryField =
  | "familyHistory"
  | "personalPathologicalHistory"
  | "nonPathologicalHistory"
  | "currentIllness";

/** Clinical history (NOM-004 6.1), same labels and order as "Editar datos". */
const HISTORY_FIELDS: { key: HistoryField; label: string }[] = [
  { key: "familyHistory", label: "Heredofamiliares" },
  { key: "personalPathologicalHistory", label: "Personales patológicos" },
  { key: "nonPathologicalHistory", label: "Personales no patológicos" },
  { key: "currentIllness", label: "Padecimiento actual" },
];

const INPUT_CLASSES =
  "w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:border-brand-primary text-sm";

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

export interface CreatedPatient {
  /** null only if the insert returned no row (should not happen). */
  id: string | null;
  name: string;
}

interface Props {
  isOpen: boolean;
  /** An accidental close (X, backdrop, Escape): the typed fields are kept. */
  onClose: () => void;
  /**
   * Called once the record exists (and the paper consent was recorded when
   * ticked). The modal then clears its fields and calls onClose.
   */
  onCreated: (patient: CreatedPatient) => void | Promise<void>;
}

/**
 * "Nuevo Paciente": the doctor's form for a new record, with the paper
 * privacy-notice checkbox. Used by the patient directory and by "Registrar
 * cita pasada". Keep it mounted: the typed fields survive an accidental close
 * and are only cleared when the doctor discards them (Cancelar) or the
 * patient is created. A ticked "firmó el aviso" box never carries over.
 */
export const NewPatientModal = ({ isOpen, onClose, onCreated }: Props) => {
  const [form, setForm] = useState(EMPTY_NEW_PATIENT);
  const [paperConsent, setPaperConsent] = useState(false);
  const [isDobPickerOpen, setIsDobPickerOpen] = useState(false);
  const [isBackgroundOpen, setIsBackgroundOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const close = () => {
    setPaperConsent(false);
    setIsDobPickerOpen(false);
    onClose();
  };
  const discard = () => {
    setForm(EMPTY_NEW_PATIENT);
    setIsBackgroundOpen(false);
    close();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName) return;
    try {
      setIsSubmitting(true);
      const patientId = await createPatient(
        form.firstName,
        form.lastName,
        form.phone,
        form.email,
        form.dob,
        form.gender,
        {
          blood_type: form.bloodType,
          allergies: form.allergies,
          chronic_conditions: form.chronicConditions,
          family_history: form.familyHistory,
          personal_pathological_history: form.personalPathologicalHistory,
          non_pathological_history: form.nonPathologicalHistory,
          current_illness: form.currentIllness,
        },
      );
      if (paperConsent) {
        try {
          if (!patientId) throw new Error("Missing patient id.");
          await recordInPersonConsent(patientId);
        } catch (consentErr: unknown) {
          console.error(
            "Error al registrar el aviso firmado:",
            consentErr instanceof Error ? consentErr.message : consentErr,
          );
          // The record exists; the doctor can tick the box again in "Editar datos".
          toast.error(
            "El paciente se creó, pero no se registró el aviso de privacidad. Márcalo de nuevo en Editar datos.",
          );
        }
      }
      await onCreated({
        id: patientId,
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
      });
      discard();
    } catch (err: unknown) {
      console.error(
        "Error al crear paciente:",
        err instanceof Error ? err.message : err,
      );
      toast.error("No se pudo crear el paciente. Intenta nuevamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Nuevo Paciente"
      icon={<UserPlus className="w-5 h-5 text-brand-primary" />}
      hideFooter={true}
    >
      <form onSubmit={handleSubmit} className="space-y-4 pb-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-bold text-brand-dark">
              Nombre(s) <span className="text-rose-500">*</span>
            </label>
            <input
              required
              type="text"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className={INPUT_CLASSES}
              placeholder="Ej. María"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-bold text-brand-dark">
              Apellidos <span className="text-rose-500">*</span>
            </label>
            <input
              required
              type="text"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className={INPUT_CLASSES}
              placeholder="Ej. González"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-bold text-brand-dark">
              Teléfono
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className={INPUT_CLASSES}
              placeholder="10 dígitos"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-bold text-brand-dark">
              Email{" "}
              <span className="text-brand-gray font-normal text-xs">
                (Opcional)
              </span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={INPUT_CLASSES}
              placeholder="correo@ejemplo.com"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Same DatePicker trigger as the patient edit modal, opened on
              past years since this is a birth date. */}
          <div className="w-full relative">
            <label
              htmlFor="new-patient-dob"
              className="text-brand-dark font-bold text-sm mb-2 block"
            >
              Fecha de nacimiento
            </label>
            <button
              id="new-patient-dob"
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
                  setForm({ ...form, dob: d });
                  setIsDobPickerOpen(false);
                }}
              />
            </div>
          </div>
          <div className="w-full">
            <label
              id="new-patient-gender-label"
              className="text-brand-dark font-bold text-sm mb-2 block"
            >
              Género
            </label>
            <Dropdown
              options={GENDER_OPTIONS}
              value={form.gender}
              onChange={(val) => setForm({ ...form, gender: val })}
              labelledBy="new-patient-gender-label"
              className="py-0! text-sm!"
            />
          </div>
        </div>
        <div className="border-t border-slate-100 pt-2">
          <button
            type="button"
            aria-expanded={isBackgroundOpen}
            aria-controls="new-patient-background"
            onClick={() => setIsBackgroundOpen((open) => !open)}
            className="text-sm font-bold text-brand-primary hover:underline cursor-pointer min-h-11 px-2"
          >
            {isBackgroundOpen
              ? "Ocultar antecedentes"
              : "Agregar antecedentes (opcional)"}
          </button>
          {isBackgroundOpen && (
            <div id="new-patient-background" className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="w-full">
                  <label
                    id="new-patient-blood-type-label"
                    className="text-brand-dark font-bold text-sm mb-2 block"
                  >
                    Tipo de sangre
                  </label>
                  <Dropdown
                    options={BLOOD_TYPE_OPTIONS}
                    value={form.bloodType}
                    onChange={(val) => setForm({ ...form, bloodType: val })}
                    labelledBy="new-patient-blood-type-label"
                    className="py-0! text-sm!"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="new-patient-allergies"
                    className="text-sm font-bold text-brand-dark"
                  >
                    Alergias
                  </label>
                  <input
                    id="new-patient-allergies"
                    type="text"
                    value={form.allergies}
                    onChange={(e) =>
                      setForm({ ...form, allergies: e.target.value })
                    }
                    className={INPUT_CLASSES}
                    placeholder="Ej. Penicilina"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="new-patient-chronic-conditions"
                  className="text-sm font-bold text-brand-dark"
                >
                  Enfermedades crónicas
                </label>
                <input
                  id="new-patient-chronic-conditions"
                  type="text"
                  value={form.chronicConditions}
                  onChange={(e) =>
                    setForm({ ...form, chronicConditions: e.target.value })
                  }
                  className={INPUT_CLASSES}
                  placeholder="Ej. Diabetes"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {HISTORY_FIELDS.map((field) => (
                  <div key={field.key} className="w-full">
                    <label
                      htmlFor={`new-patient-${field.key}`}
                      className="text-brand-dark font-bold text-sm mb-2 block"
                    >
                      {field.label}
                    </label>
                    <textarea
                      id={`new-patient-${field.key}`}
                      rows={2}
                      placeholder="Ej. Negados"
                      value={form[field.key]}
                      onChange={(e) =>
                        setForm({ ...form, [field.key]: e.target.value })
                      }
                      className="w-full px-3 py-2.5 border-2 border-brand-light rounded-lg text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all resize-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <PaperConsentCheckbox checked={paperConsent} onChange={setPaperConsent} />
        <div className="pt-4 flex gap-3 border-t border-slate-100 mt-2 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
          <Button
            type="button"
            variant="outline"
            onClick={discard}
            className="flex-1 py-3.5 rounded-xl cursor-pointer"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 py-3.5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md cursor-pointer disabled:opacity-50 font-bold"
          >
            {isSubmitting ? "Guardando..." : "Crear Expediente"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
