import type {
  BodyMeasurement,
  BodyMeasurementInput,
} from "../../../lib/services/bodyMeasurementService";
import { INDICATORS } from "./bodyComposition";

/** What the doctor typed in "Nueva medición", as text. */
export interface MeasurementForm {
  measuredAt: string;
  weight: string;
  height: string;
  bodyFatPct: string;
  bodyFatKg: string;
  skeletalMuscle: string;
  leanMass: string;
  waistHip: string;
  visceral: string;
  bmr: string;
  balance: string;
  bodyType: string;
  cid: string;
  note: string;
}

export type MeasurementNumberField = Exclude<
  keyof MeasurementForm,
  "measuredAt" | "balance" | "bodyType" | "cid" | "note"
>;

const EARLIEST_DATE = "2000-01-01";
const NOTE_MAX = 1000;

interface NumberRule {
  min: number;
  max: number;
  integer?: boolean;
  /** Mass that can never exceed the weight. */
  partOfWeight?: boolean;
  message: string;
}

// The same limits as the database checks (migration 24): they catch typos
// (700 for 70.0), not clinical judgement.
const RULES: Record<MeasurementNumberField, NumberRule> = {
  weight: { min: 0.5, max: 400, message: "Revisa el peso (0.5 a 400 kg)." },
  height: { min: 30, max: 250, message: "Revisa la talla (30 a 250 cm)." },
  bodyFatPct: { min: 1, max: 80, message: "Revisa la grasa corporal (1 a 80 %)." },
  bodyFatKg: {
    min: 0,
    max: 300,
    partOfWeight: true,
    message: "Revisa la masa grasa: no puede pasar del peso.",
  },
  skeletalMuscle: {
    min: 1,
    max: 200,
    partOfWeight: true,
    message: "Revisa la masa muscular: no puede pasar del peso.",
  },
  leanMass: {
    min: 1,
    max: 400,
    partOfWeight: true,
    message: "Revisa la masa magra: no puede pasar del peso.",
  },
  waistHip: {
    min: 0.4,
    max: 2,
    message: "Revisa la relación cintura-cadera (0.40 a 2.00).",
  },
  visceral: {
    min: 1,
    max: 30,
    integer: true,
    message: "Revisa la grasa visceral (número entero de 1 a 30).",
  },
  bmr: {
    min: 300,
    max: 5000,
    integer: true,
    message: "Revisa el metabolismo basal (300 a 5000 kcal, sin decimales).",
  },
};

/**
 * Decimals each field accepts: the decimals the screen SHOWS for it
 * (bodyComposition INDICATORS), so a typed value, its display and the change
 * against the previous measurement always agree (no 70.25 shown as 70.3).
 */
export const FIELD_DECIMALS: Record<MeasurementNumberField, number> = {
  weight: INDICATORS.weight_kg.decimals,
  // Not a charted indicator; the database keeps one decimal (numeric(4,1)).
  height: 1,
  bodyFatPct: INDICATORS.body_fat_pct.decimals,
  bodyFatKg: INDICATORS.body_fat_kg.decimals,
  skeletalMuscle: INDICATORS.skeletal_muscle_kg.decimals,
  leanMass: INDICATORS.lean_mass_kg.decimals,
  waistHip: INDICATORS.waist_hip_ratio.decimals,
  visceral: INDICATORS.visceral_fat_level.decimals,
  bmr: INDICATORS.bmr_kcal.decimals,
};

/**
 * Keeps digits and one decimal separator (a comma becomes a point), with at
 * most `maxDecimals` digits after it.
 */
export const sanitizeDecimal = (text: string, maxDecimals = Infinity): string => {
  const cleaned = text.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  if (rest.length === 0) return whole;
  if (maxDecimals <= 0) return whole;
  return `${whole}.${rest.join("").slice(0, maxDecimals)}`;
};

/** A pre-filled number rounded to the field's decimals ("70.25" -> "70.3"). */
const roundedText = (text: string | undefined, decimals: number): string => {
  const trimmed = sanitizeDecimal(text?.trim() ?? "");
  if (trimmed === "" || trimmed === ".") return "";
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "";
  const rounded = Number(value.toFixed(decimals));
  return String(rounded);
};

/** Keeps digits only (levels and kcal). */
export const sanitizeInteger = (text: string): string => text.replace(/\D/g, "");

const toNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(/,/g, ".");
  if (trimmed === "") return null;
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(trimmed)) return NaN;
  return Number(trimmed);
};

export const emptyMeasurementForm = (
  today: string,
  prefill: { weight?: string; height?: string } = {},
): MeasurementForm => ({
  measuredAt: today,
  weight: roundedText(prefill.weight, FIELD_DECIMALS.weight),
  height: roundedText(prefill.height, FIELD_DECIMALS.height),
  bodyFatPct: "",
  bodyFatKg: "",
  skeletalMuscle: "",
  leanMass: "",
  waistHip: "",
  visceral: "",
  bmr: "",
  balance: "",
  bodyType: "",
  cid: "",
  note: "",
});

const text = (value: number | null) => (value === null ? "" : String(value));

/** A stored measurement back into the editable form. */
export const toMeasurementForm = (m: BodyMeasurement): MeasurementForm => ({
  measuredAt: m.measured_at,
  weight: text(m.weight_kg),
  height: text(m.height_cm),
  bodyFatPct: text(m.body_fat_pct),
  bodyFatKg: text(m.body_fat_kg),
  skeletalMuscle: text(m.skeletal_muscle_kg),
  leanMass: text(m.lean_mass_kg),
  waistHip: text(m.waist_hip_ratio),
  visceral: text(m.visceral_fat_level),
  bmr: text(m.bmr_kcal),
  balance: m.balance_upper_lower ?? "",
  bodyType: m.body_type ?? "",
  cid: m.cid_type ?? "",
  note: m.note ?? "",
});

export type ParsedMeasurement =
  | { ok: true; value: Omit<BodyMeasurementInput, "appointment_id"> }
  | { ok: false; message: string };

/**
 * Turns the typed form into the values to store. `today` is the clinic's
 * date ("YYYY-MM-DD"). Returns a short Spanish message for the first problem.
 */
export const parseMeasurementForm = (
  form: MeasurementForm,
  today: string,
): ParsedMeasurement => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.measuredAt) || form.measuredAt < EARLIEST_DATE) {
    return { ok: false, message: "Elige la fecha de la medición." };
  }
  if (form.measuredAt > today) {
    return { ok: false, message: "La fecha de la medición no puede ser futura." };
  }

  // Rounded to the decimals the screen shows (a stored value from before the
  // cap, or a pasted one, never keeps hidden digits).
  const values = {} as Record<MeasurementNumberField, number | null>;
  for (const field of Object.keys(RULES) as MeasurementNumberField[]) {
    const value = toNumber(form[field]);
    values[field] =
      value === null || Number.isNaN(value) || RULES[field].integer
        ? value
        : Number(value.toFixed(FIELD_DECIMALS[field]));
  }

  if (values.weight === null) {
    return { ok: false, message: "Escribe el peso en kilos." };
  }

  for (const field of Object.keys(RULES) as MeasurementNumberField[]) {
    const value = values[field];
    if (value === null) continue;
    const rule = RULES[field];
    const weight = values.weight;
    if (
      Number.isNaN(value) ||
      value < rule.min ||
      value > rule.max ||
      (rule.integer && !Number.isInteger(value)) ||
      (rule.partOfWeight && !Number.isNaN(weight) && value > weight)
    ) {
      return { ok: false, message: rule.message };
    }
  }

  const note = form.note.trim();
  if (note.length > NOTE_MAX) {
    return { ok: false, message: "La nota es demasiado larga (máximo 1000 caracteres)." };
  }

  return {
    ok: true,
    value: {
      measured_at: form.measuredAt,
      weight_kg: values.weight,
      height_cm: values.height,
      body_fat_pct: values.bodyFatPct,
      body_fat_kg: values.bodyFatKg,
      skeletal_muscle_kg: values.skeletalMuscle,
      lean_mass_kg: values.leanMass,
      waist_hip_ratio: values.waistHip,
      visceral_fat_level: values.visceral,
      bmr_kcal: values.bmr,
      balance_upper_lower: form.balance || null,
      body_type: form.bodyType || null,
      cid_type: form.cid || null,
      note: note || null,
    },
  };
};
