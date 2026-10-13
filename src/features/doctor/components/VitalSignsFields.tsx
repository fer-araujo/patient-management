import type { VitalSignsForm } from "../utils/vitalSigns";

interface VitalSignsFieldsProps {
  value: VitalSignsForm;
  onChange: (value: VitalSignsForm) => void;
  disabled?: boolean;
}

const VALUE_INPUT_CLASSES =
  "w-full pointer-coarse:min-h-11 bg-transparent text-base font-bold text-brand-dark focus:outline-none mt-0.5 placeholder:font-normal placeholder:text-brand-dark/50";
const PRESSURE_INPUT_CLASSES =
  "w-8 pointer-coarse:w-16 pointer-coarse:min-h-11 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-brand-primary/30 rounded placeholder:font-normal placeholder:text-brand-dark/50";
const CELL_CLASSES = "bg-slate-50 p-2 rounded-lg border border-slate-100";
const CELL_LABEL_CLASSES = "text-[10px] font-bold text-brand-gray uppercase";

/**
 * The vital signs boxes of the consultation (same inputs and limits), for
 * notes written outside it: an open note in the record and a past visit.
 * Values are text; parseVitalSigns turns them into the stored numbers.
 */
export const VitalSignsFields = ({ value, onChange, disabled = false }: VitalSignsFieldsProps) => {
  const set = (key: keyof VitalSignsForm, text: string) => onChange({ ...value, [key]: text });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div className={CELL_CLASSES}>
        <p className={CELL_LABEL_CLASSES}>Presión arterial</p>
        <div className="flex items-center gap-1 mt-0.5 text-base font-bold text-brand-dark">
          <input
            type="text"
            inputMode="decimal"
            aria-label="Presión sistólica"
            disabled={disabled}
            placeholder="—"
            value={value.bpSys}
            onChange={(e) => set("bpSys", e.target.value.replace(/\D/g, "").slice(0, 3))}
            className={PRESSURE_INPUT_CLASSES}
          />
          <span className="text-slate-400">/</span>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Presión diastólica"
            disabled={disabled}
            placeholder="—"
            value={value.bpDia}
            onChange={(e) => set("bpDia", e.target.value.replace(/\D/g, "").slice(0, 3))}
            className={PRESSURE_INPUT_CLASSES}
          />
        </div>
      </div>
      <div className={CELL_CLASSES}>
        <p className={CELL_LABEL_CLASSES}>Oxigenación (%)</p>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Oxigenación"
          disabled={disabled}
          placeholder="—"
          value={value.spo2}
          onChange={(e) => set("spo2", e.target.value.replace(/\D/g, "").slice(0, 3))}
          className={VALUE_INPUT_CLASSES}
        />
      </div>
      <div className={CELL_CLASSES}>
        <p className={CELL_LABEL_CLASSES}>Peso (kg)</p>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Peso"
          disabled={disabled}
          placeholder="—"
          value={value.weight}
          onChange={(e) => set("weight", e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
          className={VALUE_INPUT_CLASSES}
        />
      </div>
      <div className={CELL_CLASSES}>
        <p className={CELL_LABEL_CLASSES}>Talla (cm)</p>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Talla"
          disabled={disabled}
          placeholder="Opcional"
          value={value.height}
          onChange={(e) => set("height", e.target.value.replace(/\D/g, "").slice(0, 3))}
          className={VALUE_INPUT_CLASSES}
        />
      </div>
    </div>
  );
};
