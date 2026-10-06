/**
 * Body composition (InBody) indicators: labels, units, reference ranges and
 * the level ("Bajo / Normal / Alto") of a value. Pure, no React.
 *
 * Reference ranges (adults; general screening references, not a diagnosis):
 * - BMI (IMC): WHO adult classification - underweight < 18.5, normal
 *   18.5-24.9, overweight >= 25 kg/m2. Same for both sexes.
 * - Body fat % (PGC): the standard ranges printed on the InBody result sheet
 *   (InBody 270/570 result interpretation guide) - men 10-20 %, women
 *   18-28 %. Sex-specific: without a known sex no zone is shown.
 * - Visceral fat level: InBody scale 1-20; level 1-9 normal, 10 or more high.
 *   No "low" zone.
 * - Waist-hip ratio: WHO "Waist circumference and waist-hip ratio" (2008)
 *   cut-offs for increased metabolic risk - men above 0.90, women above 0.85.
 *   Sex-specific; no "low" zone.
 * Weight, fat mass, skeletal muscle, lean mass and basal metabolic rate
 * depend on height, age and sex in ways a fixed range would misstate, so
 * they show their value and trend only.
 */

/** A body measurement column the screen can show as a number. */
export type IndicatorKey =
  | "weight_kg"
  | "bmi"
  | "body_fat_pct"
  | "body_fat_kg"
  | "skeletal_muscle_kg"
  | "lean_mass_kg"
  | "waist_hip_ratio"
  | "visceral_fat_level"
  | "bmr_kcal";

export interface IndicatorInfo {
  key: IndicatorKey;
  label: string;
  /** Unit shown after the value; empty for a ratio or a level. */
  unit: string;
  decimals: number;
}

export const INDICATORS: Record<IndicatorKey, IndicatorInfo> = {
  weight_kg: { key: "weight_kg", label: "Peso", unit: "kg", decimals: 1 },
  bmi: { key: "bmi", label: "IMC", unit: "kg/m²", decimals: 1 },
  body_fat_pct: { key: "body_fat_pct", label: "Grasa corporal", unit: "%", decimals: 1 },
  body_fat_kg: { key: "body_fat_kg", label: "Masa grasa", unit: "kg", decimals: 1 },
  skeletal_muscle_kg: {
    key: "skeletal_muscle_kg",
    label: "Masa muscular",
    unit: "kg",
    decimals: 1,
  },
  lean_mass_kg: { key: "lean_mass_kg", label: "Masa magra", unit: "kg", decimals: 1 },
  waist_hip_ratio: {
    key: "waist_hip_ratio",
    label: "Cintura-cadera",
    unit: "",
    decimals: 2,
  },
  visceral_fat_level: {
    key: "visceral_fat_level",
    label: "Grasa visceral",
    unit: "",
    decimals: 0,
  },
  bmr_kcal: { key: "bmr_kcal", label: "Metabolismo basal", unit: "kcal", decimals: 0 },
};

/** Sex used for the sex-specific ranges; null when it is not recorded. */
export type BodySex = "male" | "female" | null;

/** patients.gender ("Femenino" / "Masculino" / "Otro") to a range sex. */
export const sexFromGender = (gender: string | null | undefined): BodySex => {
  const value = gender?.trim().toLowerCase();
  if (value === "femenino") return "female";
  if (value === "masculino") return "male";
  return null;
};

export type LevelZone = "low" | "normal" | "high";

export const LEVEL_LABELS: Record<LevelZone, string> = {
  low: "Bajo",
  normal: "Normal",
  high: "Alto",
};

/**
 * The normal range [normalMin, normalMax] (both inclusive; normalMin null
 * when there is no "low" zone) drawn on a bar from scaleMin to scaleMax.
 */
export interface LevelScale {
  scaleMin: number;
  scaleMax: number;
  normalMin: number | null;
  normalMax: number;
}

/**
 * The reference scale of an indicator for a sex, or null when the indicator
 * has no reliable range (or needs a sex that is unknown).
 */
export const referenceScale = (key: IndicatorKey, sex: BodySex): LevelScale | null => {
  switch (key) {
    case "bmi":
      return { scaleMin: 10, scaleMax: 40, normalMin: 18.5, normalMax: 24.9 };
    case "visceral_fat_level":
      return { scaleMin: 1, scaleMax: 20, normalMin: null, normalMax: 9 };
    case "body_fat_pct":
      if (sex === "male") return { scaleMin: 0, scaleMax: 40, normalMin: 10, normalMax: 20 };
      if (sex === "female") return { scaleMin: 0, scaleMax: 50, normalMin: 18, normalMax: 28 };
      return null;
    case "waist_hip_ratio":
      if (sex === "male") return { scaleMin: 0.6, scaleMax: 1.2, normalMin: null, normalMax: 0.9 };
      if (sex === "female") return { scaleMin: 0.6, scaleMax: 1.2, normalMin: null, normalMax: 0.85 };
      return null;
    default:
      return null;
  }
};

/** The level of `value` on `scale`; both normal bounds are inclusive. */
export const classifyLevel = (value: number, scale: LevelScale): LevelZone => {
  if (scale.normalMin !== null && value < scale.normalMin) return "low";
  if (value > scale.normalMax) return "high";
  return "normal";
};

const fraction = (value: number, scale: LevelScale) =>
  Math.min(1, Math.max(0, (value - scale.scaleMin) / (scale.scaleMax - scale.scaleMin)));

/** Where `value` sits on the bar, from 0 (left) to 1 (right), clamped. */
export const markerPosition = (value: number, scale: LevelScale): number =>
  fraction(value, scale);

/** Widths (0-1) of the low, normal and high zones on the bar. */
export const zoneWidths = (scale: LevelScale): Record<LevelZone, number> => {
  const lowEnd = scale.normalMin === null ? 0 : fraction(scale.normalMin, scale);
  const normalEnd = fraction(scale.normalMax, scale);
  return { low: lowEnd, normal: normalEnd - lowEnd, high: 1 - normalEnd };
};

/** "70.5" with the indicator's decimals, in Mexican Spanish format. */
export const formatIndicator = (value: number, key: IndicatorKey): string =>
  value.toLocaleString("es-MX", {
    minimumFractionDigits: INDICATORS[key].decimals,
    maximumFractionDigits: INDICATORS[key].decimals,
  });

/** "70.5 kg", "0.88", "8" - value and unit as plain text. */
export const formatWithUnit = (value: number, key: IndicatorKey): string => {
  const unit = INDICATORS[key].unit;
  return unit ? `${formatIndicator(value, key)} ${unit}` : formatIndicator(value, key);
};

export interface IndicatorChange {
  direction: "up" | "down" | "same";
  /** Absolute difference, rounded to the indicator's decimals. */
  amount: number;
  /** "▲ 1.2 kg", "▼ 0.5 %", "Sin cambio". */
  text: string;
}

/** Change of an indicator against the previous measurement. */
export const describeChange = (
  current: number,
  previous: number,
  key: IndicatorKey,
): IndicatorChange => {
  const factor = 10 ** INDICATORS[key].decimals;
  const diff = Math.round((current - previous) * factor) / factor;
  if (diff === 0) return { direction: "same", amount: 0, text: "Sin cambio" };
  const amount = Math.abs(diff);
  return {
    direction: diff > 0 ? "up" : "down",
    amount,
    text: `${diff > 0 ? "▲" : "▼"} ${formatWithUnit(amount, key)}`,
  };
};

// -----------------------------------------------------------------------------
// Closed lists (the same values as the database checks, migration 24)
// -----------------------------------------------------------------------------

export const BALANCE_OPTIONS = [
  { value: "equilibrado", label: "Equilibrado" },
  { value: "ligero_desequilibrio", label: "Ligero desequilibrio" },
  { value: "desequilibrio", label: "Desequilibrio" },
] as const;

export const BODY_TYPE_OPTIONS = [
  { value: "obesidad_sarcopenica", label: "Obesidad sarcopénica" },
  { value: "obesidad", label: "Obesidad" },
  { value: "obesidad_leve", label: "Obesidad leve" },
  { value: "sobrepeso", label: "Sobrepeso" },
  { value: "promedio", label: "Promedio" },
  { value: "figura_atletica", label: "Figura atlética" },
  { value: "figura_musculosa", label: "Figura musculosa" },
  { value: "esbelto", label: "Esbelto" },
  { value: "esbelto_musculoso", label: "Esbelto musculoso" },
  { value: "ligeramente_delgado", label: "Ligeramente delgado" },
  { value: "delgado", label: "Delgado" },
] as const;

export const CID_OPTIONS = [
  { value: "tipo_c", label: "Forma C" },
  { value: "tipo_i", label: "Forma I" },
  { value: "tipo_d", label: "Forma D" },
] as const;

export type BalanceValue = (typeof BALANCE_OPTIONS)[number]["value"];
export type BodyTypeValue = (typeof BODY_TYPE_OPTIONS)[number]["value"];
export type CidValue = (typeof CID_OPTIONS)[number]["value"];

const labelOf = (
  options: readonly { value: string; label: string }[],
  value: string | null | undefined,
): string | null => options.find((o) => o.value === value)?.label ?? null;

export const balanceLabel = (value: string | null | undefined) => labelOf(BALANCE_OPTIONS, value);
export const bodyTypeLabel = (value: string | null | undefined) =>
  labelOf(BODY_TYPE_OPTIONS, value);
export const cidLabel = (value: string | null | undefined) => labelOf(CID_OPTIONS, value);

// -----------------------------------------------------------------------------
// Measurement dates ("YYYY-MM-DD" on the clinic's calendar)
// -----------------------------------------------------------------------------

/**
 * UTC midnight of a clinic date: a stable position on a time axis that does
 * not depend on the browser's zone.
 */
export const measurementDateToMs = (isoDate: string): number => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** "15 oct 2026" (short) or "15 de octubre de 2026" for a clinic date. */
export const formatMeasurementDate = (isoDate: string, short = true): string =>
  new Date(measurementDateToMs(isoDate))
    .toLocaleDateString("es-MX", {
      timeZone: "UTC",
      day: "numeric",
      month: short ? "short" : "long",
      year: "numeric",
    })
    .replace(/\./g, "");
