import { useState, type FormEvent } from "react";
import { Pill } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { Dropdown } from "../../../components/ui/Dropdown";
import type { MedicationItem } from "../../../lib/services/soapService";
import {
  EMPTY_MEDICATION_FORM,
  MEDICATION_LIMITS,
  MEDICATION_ROUTES,
  medicationToForm,
  validateMedicationForm,
  type MedicationErrors,
  type MedicationForm,
} from "./medication";

/** Same classes as the original "Nueva Indicación" form. */
const INPUT_CLASSES =
  "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:border-brand-primary outline-none";
const LABEL_CLASSES = "text-brand-dark font-bold text-base mb-2 block";

const ROUTE_OPTIONS = MEDICATION_ROUTES.map((route) => ({ label: route, value: route }));

type TextField = Exclude<keyof MedicationForm, "via" | "indicaciones">;

const TEXT_FIELDS: { key: TextField; label: string; placeholder: string; required: boolean }[] = [
  { key: "nombre", label: "Medicamento (nombre genérico)", placeholder: "Ej. Ibuprofeno", required: true },
  { key: "presentacion", label: "Presentación", placeholder: "Ej. Tabletas de 400 mg", required: false },
  { key: "dosis", label: "Dosis", placeholder: "Ej. 1 tableta", required: true },
];

const SCHEDULE_FIELDS: { key: TextField; label: string; placeholder: string; required: boolean }[] = [
  { key: "frecuencia", label: "Frecuencia", placeholder: "Ej. Cada 8 horas", required: true },
  { key: "duracion", label: "Duración", placeholder: "Ej. 5 días", required: false },
];

interface NewMedicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (medication: MedicationItem) => void;
  /** An item of today's prescription to complete (e.g. copied from an old one). */
  initial?: MedicationItem;
}

/**
 * "Nueva Indicación": one structured medication (migration 25). Medicamento,
 * Dosis, Vía and Frecuencia are required. With `initial`, the same form
 * opens prefilled to complete that item. Re-mount (key) to start again.
 */
export const NewMedicationModal = ({ isOpen, onClose, onAdd, initial }: NewMedicationModalProps) => {
  const [form, setForm] = useState<MedicationForm>(() =>
    initial ? medicationToForm(initial) : EMPTY_MEDICATION_FORM,
  );
  const [errors, setErrors] = useState<MedicationErrors>({});

  const setField = (key: keyof MedicationForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateMedicationForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onAdd(result.value);
    setForm(EMPTY_MEDICATION_FORM);
    setErrors({});
  };

  const fieldError = (key: keyof MedicationForm) =>
    errors[key] ? (
      <p id={`medication-${key}-error`} role="alert" className="text-base font-medium text-rose-600 mt-1">
        {errors[key]}
      </p>
    ) : null;

  const textInput = ({
    key,
    label,
    placeholder,
    required,
  }: (typeof TEXT_FIELDS)[number]) => (
    <div key={key}>
      <label htmlFor={`medication-${key}`} className={LABEL_CLASSES}>
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      <input
        id={`medication-${key}`}
        type="text"
        autoComplete="off"
        maxLength={MEDICATION_LIMITS[key]}
        value={form[key]}
        onChange={(e) => setField(key, e.target.value)}
        placeholder={placeholder}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `medication-${key}-error` : undefined}
        className={INPUT_CLASSES}
      />
      {fieldError(key)}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? "Completar Indicación Médica" : "Nueva Indicación Médica"}
      icon={<Pill className="w-6 h-6 text-brand-primary" />}
      hideFooter={true}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5 pb-2">
        {TEXT_FIELDS.map(textInput)}
        <div>
          <span id="medication-via" className={LABEL_CLASSES}>
            Vía <span className="text-rose-500"> *</span>
          </span>
          <Dropdown
            labelledBy="medication-via"
            options={ROUTE_OPTIONS}
            value={form.via}
            onChange={(value) => setField("via", value)}
            placeholder="Elige la vía"
          />
          {fieldError("via")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SCHEDULE_FIELDS.map(textInput)}
        </div>
        <div>
          <label htmlFor="medication-indicaciones" className={LABEL_CLASSES}>
            Indicaciones
          </label>
          <textarea
            id="medication-indicaciones"
            maxLength={MEDICATION_LIMITS.indicaciones}
            value={form.indicaciones}
            onChange={(e) => setField("indicaciones", e.target.value)}
            placeholder="Ej. Tomar con alimentos"
            className={`${INPUT_CLASSES} resize-none h-28`}
          />
          {fieldError("indicaciones")}
        </div>
        <p className="text-base text-brand-gray">
          No recetes aquí medicamentos controlados (Grupos I a III).
        </p>
        <div className="pt-4 border-t border-slate-100 flex gap-3 mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="flex-1 py-4 rounded-xl cursor-pointer text-base"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="flex-1 py-4 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md disabled:opacity-50 cursor-pointer text-base font-bold"
          >
            {initial ? "Guardar cambios" : "Añadir a la Receta"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
