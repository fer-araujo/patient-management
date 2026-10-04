import type { VitalSigns } from "../../../lib/services/soapService";

/** What the doctor typed in the vital signs box, as text. */
export interface VitalSignsForm {
  bpSys: string;
  bpDia: string;
  spo2: string;
  weight: string;
  height: string;
}

export const EMPTY_VITAL_SIGNS: VitalSignsForm = {
  bpSys: "",
  bpDia: "",
  spo2: "",
  weight: "",
  height: "",
};

// Wide, physiologically possible ranges: they catch typos (e.g. 1200 for
// 120), not clinical judgement.
const RANGES = {
  bpSys: { min: 50, max: 260 },
  bpDia: { min: 30, max: 160 },
  spo2: { min: 50, max: 100 },
  weight: { min: 0.5, max: 400 },
  height: { min: 30, max: 250 },
} as const;

const MESSAGES = {
  bp: "Revisa la presión arterial.",
  bpPair: "Escribe las dos cifras de la presión arterial.",
  spo2: "Revisa la oxigenación (50 a 100 %).",
  weight: "Revisa el peso en kilos.",
  height: "Revisa la talla en centímetros.",
} as const;

const toNumber = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
};

const inRange = (value: number, key: keyof typeof RANGES) =>
  !Number.isNaN(value) && value >= RANGES[key].min && value <= RANGES[key].max;

export type ParsedVitalSigns =
  | { ok: true; value: VitalSigns | null }
  | { ok: false; message: string };

/**
 * Turns the typed vital signs into the stored numbers. Empty fields are left
 * out; nothing typed at all gives null. Out-of-range values return a short
 * Spanish message for the doctor.
 */
export const parseVitalSigns = (form: VitalSignsForm): ParsedVitalSigns => {
  const bpSys = toNumber(form.bpSys);
  const bpDia = toNumber(form.bpDia);
  const spo2 = toNumber(form.spo2);
  const weight = toNumber(form.weight);
  const height = toNumber(form.height);

  if ((bpSys === null) !== (bpDia === null)) {
    return { ok: false, message: MESSAGES.bpPair };
  }
  if (bpSys !== null && bpDia !== null) {
    if (!inRange(bpSys, "bpSys") || !inRange(bpDia, "bpDia") || bpDia >= bpSys) {
      return { ok: false, message: MESSAGES.bp };
    }
  }
  if (spo2 !== null && !inRange(spo2, "spo2")) {
    return { ok: false, message: MESSAGES.spo2 };
  }
  if (weight !== null && !inRange(weight, "weight")) {
    return { ok: false, message: MESSAGES.weight };
  }
  if (height !== null && !inRange(height, "height")) {
    return { ok: false, message: MESSAGES.height };
  }

  const value: VitalSigns = {};
  if (bpSys !== null && bpDia !== null) {
    value.bp_sys = bpSys;
    value.bp_dia = bpDia;
  }
  if (spo2 !== null) value.spo2 = spo2;
  if (weight !== null) value.weight_kg = weight;
  if (height !== null) value.height_cm = height;

  return { ok: true, value: Object.keys(value).length > 0 ? value : null };
};

/** Stored numbers back into the editable text form (draft reload). */
export const toVitalSignsForm = (value: VitalSigns | null): VitalSignsForm => ({
  bpSys: value?.bp_sys != null ? String(value.bp_sys) : "",
  bpDia: value?.bp_dia != null ? String(value.bp_dia) : "",
  spo2: value?.spo2 != null ? String(value.spo2) : "",
  weight: value?.weight_kg != null ? String(value.weight_kg) : "",
  height: value?.height_cm != null ? String(value.height_cm) : "",
});

const formatNumber = (value: number) =>
  value.toLocaleString("es-MX", { maximumFractionDigits: 1 });

/**
 * One line per recorded vital sign, in full words (NOM-004 5.11: no
 * abbreviations), e.g. "Presión arterial 120/80 mmHg".
 */
export const describeVitalSigns = (value: VitalSigns | null): string[] => {
  if (!value) return [];
  const lines: string[] = [];
  if (value.bp_sys != null && value.bp_dia != null) {
    lines.push(`Presión arterial ${value.bp_sys}/${value.bp_dia} mmHg`);
  }
  if (value.spo2 != null) lines.push(`Oxigenación ${formatNumber(value.spo2)} %`);
  if (value.weight_kg != null) lines.push(`Peso ${formatNumber(value.weight_kg)} kg`);
  if (value.height_cm != null) lines.push(`Talla ${formatNumber(value.height_cm)} cm`);
  return lines;
};
