import { useState, type FormEvent } from "react";
import { Calendar as CalendarIcon, Loader2, Scale } from "lucide-react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DatePicker } from "../../../../components/ui/DatePicker";
import type { BodyMeasurementInput } from "../../../../lib/services/bodyMeasurementService";
import {
  BALANCE_OPTIONS,
  BODY_TYPE_OPTIONS,
  CID_OPTIONS,
  formatIndicator,
  formatMeasurementDate,
} from "../../utils/bodyComposition";
import {
  FIELD_DECIMALS,
  parseMeasurementForm,
  sanitizeDecimal,
  sanitizeInteger,
  type MeasurementForm,
  type MeasurementNumberField,
} from "../../utils/measurementForm";

/** The same input as the "Nueva Indicación" form (16px text, 48px tall). */
const INPUT_CLASSES =
  "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:border-brand-primary outline-none";
const LABEL_CLASSES = "text-brand-dark font-bold text-sm mb-2 block";
const SECTION_TITLE_CLASSES =
  "text-xs font-black text-brand-gray uppercase tracking-widest";

interface NumberFieldDef {
  field: MeasurementNumberField;
  label: string;
  integer?: boolean;
}

const SECTIONS: { title: string; fields: NumberFieldDef[] }[] = [
  {
    title: "Composición corporal",
    fields: [
      { field: "bodyFatPct", label: "Grasa corporal (%)" },
      { field: "bodyFatKg", label: "Masa grasa (kg)" },
      { field: "skeletalMuscle", label: "Masa muscular esquelética (kg)" },
      { field: "leanMass", label: "Masa magra (kg)" },
    ],
  },
  {
    title: "Obesidad abdominal",
    fields: [
      { field: "waistHip", label: "Relación cintura-cadera" },
      { field: "visceral", label: "Grasa visceral (nivel)", integer: true },
    ],
  },
  {
    title: "Metabolismo",
    fields: [{ field: "bmr", label: "Metabolismo basal (kcal)", integer: true }],
  },
];

const withEmpty = (options: readonly { value: string; label: string }[]) => [
  { value: "", label: "Sin dato" },
  ...options,
];

const CLOSED_LISTS: {
  key: "balance" | "bodyType" | "cid";
  label: string;
  options: { value: string; label: string }[];
}[] = [
  { key: "balance", label: "Equilibrio superior-inferior", options: withEmpty(BALANCE_OPTIONS) },
  { key: "bodyType", label: "Tipo de cuerpo", options: withEmpty(BODY_TYPE_OPTIONS) },
  { key: "cid", label: "Forma C / I / D", options: withEmpty(CID_OPTIONS) },
];

/** BMI preview, the same formula the database stores. */
const previewBmi = (weight: string, height: string): string | null => {
  const w = Number(weight);
  const h = Number(height);
  if (!weight || !height || !(w > 0) || !(h >= 30)) return null;
  return formatIndicator(Math.round((w / (h / 100) ** 2) * 10) / 10, "bmi");
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  initial: MeasurementForm;
  /** Clinic date "YYYY-MM-DD": the latest date allowed. */
  today: string;
  /** Rejects with a Spanish message; the form then stays open. */
  onSave: (value: Omit<BodyMeasurementInput, "appointment_id">) => Promise<void>;
}

/**
 * "Nueva medición" / "Editar medición". Re-mount it (key) to start from a
 * new `initial`.
 */
export const MeasurementFormModal = ({
  isOpen,
  onClose,
  title,
  initial,
  today,
  onSave,
}: Props) => {
  const [form, setForm] = useState<MeasurementForm>(initial);
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const set = (changes: Partial<MeasurementForm>) => {
    setForm((prev) => ({ ...prev, ...changes }));
    setError(null);
  };
  const setField = (field: keyof MeasurementForm, value: string) =>
    set({ [field]: value } as Partial<MeasurementForm>);

  // While saving, the form cannot be closed (Cancelar, backdrop, Escape): the
  // result must land on the form that sent it.
  const handleClose = () => {
    if (!isSaving) onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const parsed = parseMeasurementForm(form, today);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(parsed.value);
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo guardar la medición.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const numberInput = ({ field, label, integer }: NumberFieldDef, required = false) => (
    <div key={field}>
      <label htmlFor={`measurement-${field}`} className={LABEL_CLASSES}>
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      <input
        id={`measurement-${field}`}
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        autoComplete="off"
        value={form[field]}
        onChange={(e) =>
          setField(
            field,
            integer
              ? sanitizeInteger(e.target.value).slice(0, 4)
              : sanitizeDecimal(e.target.value, FIELD_DECIMALS[field]).slice(0, 6),
          )
        }
        placeholder={required ? "Ej. 68.5" : "Opcional"}
        className={INPUT_CLASSES}
      />
    </div>
  );

  const bmi = previewBmi(form.weight, form.height);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      icon={<Scale className="w-6 h-6 text-brand-primary" />}
      hideFooter={true}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-6 pb-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="measurement-date" className={LABEL_CLASSES}>
              Fecha <span className="text-rose-500">*</span>
            </label>
            <button
              id="measurement-date"
              type="button"
              onClick={() => setIsDateOpen(true)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-base font-medium text-left transition-all flex items-center justify-between group cursor-pointer"
            >
              <span className="text-brand-dark">
                {formatMeasurementDate(form.measuredAt)}
              </span>
              <CalendarIcon className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
            </button>
            <DatePicker
              isOpen={isDateOpen}
              onClose={() => setIsDateOpen(false)}
              selectedDate={form.measuredAt}
              maxDate={today}
              allowPast
              title="Fecha de la medición"
              onSelectDate={(d) => {
                set({ measuredAt: d });
                setIsDateOpen(false);
              }}
            />
          </div>
          {numberInput({ field: "weight", label: "Peso (kg)" }, true)}
          {numberInput({ field: "height", label: "Talla (cm)" })}
        </div>
        <p className="text-sm font-medium text-brand-gray -mt-3">
          {bmi
            ? `IMC: ${bmi} kg/m² (se calcula con el peso y la talla)`
            : "El IMC se calcula solo cuando hay peso y talla."}
        </p>

        {SECTIONS.map((section) => (
          <fieldset key={section.title} className="space-y-3">
            <legend className={SECTION_TITLE_CLASSES}>{section.title}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {section.fields.map((def) => numberInput(def))}
            </div>
          </fieldset>
        ))}

        <fieldset className="space-y-3">
          <legend className={SECTION_TITLE_CLASSES}>Equilibrio y tipo de cuerpo</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {CLOSED_LISTS.map((list) => (
              <div key={list.key}>
                <span id={`measurement-${list.key}`} className={LABEL_CLASSES}>
                  {list.label}
                </span>
                <Dropdown
                  labelledBy={`measurement-${list.key}`}
                  options={list.options}
                  value={form[list.key]}
                  onChange={(value) => setField(list.key, value)}
                  placeholder="Sin dato"
                />
              </div>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="measurement-note" className={LABEL_CLASSES}>
            Nota
          </label>
          <textarea
            id="measurement-note"
            rows={2}
            maxLength={1000}
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="Opcional"
            className={`${INPUT_CLASSES} resize-none`}
          />
        </div>

        {error && (
          <p role="alert" className="text-base font-bold text-rose-600">
            {error}
          </p>
        )}

        <div className="pt-4 border-t border-slate-100 flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSaving}
            className="flex-1 py-4 rounded-xl cursor-pointer text-base disabled:opacity-50"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isSaving}
            className="flex-1 py-4 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md disabled:opacity-50 cursor-pointer text-base font-bold"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar medición
          </Button>
        </div>
      </form>
    </Modal>
  );
};
