import { describe, expect, it } from "vitest";
import {
  emptyMeasurementForm,
  parseMeasurementForm,
  sanitizeDecimal,
  FIELD_DECIMALS,
  sanitizeInteger,
  toMeasurementForm,
  type MeasurementForm,
} from "./measurementForm";
import type { BodyMeasurement } from "../../../lib/services/bodyMeasurementService";

const TODAY = "2026-10-04";

const form = (over: Partial<MeasurementForm> = {}): MeasurementForm => ({
  ...emptyMeasurementForm(TODAY),
  weight: "70",
  ...over,
});

const parse = (over: Partial<MeasurementForm> = {}) => parseMeasurementForm(form(over), TODAY);

describe("parseMeasurementForm", () => {
  it("needs only the date and the weight; the rest stays null", () => {
    expect(parse()).toEqual({
      ok: true,
      value: {
        measured_at: TODAY,
        weight_kg: 70,
        height_cm: null,
        body_fat_pct: null,
        body_fat_kg: null,
        skeletal_muscle_kg: null,
        lean_mass_kg: null,
        waist_hip_ratio: null,
        visceral_fat_level: null,
        bmr_kcal: null,
        balance_upper_lower: null,
        body_type: null,
        cid_type: null,
        note: null,
      },
    });
  });

  it("reads every InBody value, a decimal comma and the closed lists", () => {
    const result = parse({
      weight: "68,5",
      height: "170",
      bodyFatPct: "30.5",
      bodyFatKg: "20.9",
      skeletalMuscle: "26.1",
      leanMass: "47.6",
      waistHip: "0.88",
      visceral: "8",
      bmr: "1350",
      balance: "equilibrado",
      bodyType: "sobrepeso",
      cid: "tipo_c",
      note: "  En ayunas  ",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        weight_kg: 68.5,
        height_cm: 170,
        body_fat_pct: 30.5,
        waist_hip_ratio: 0.88,
        visceral_fat_level: 8,
        bmr_kcal: 1350,
        balance_upper_lower: "equilibrado",
        body_type: "sobrepeso",
        cid_type: "tipo_c",
        note: "En ayunas",
      },
    });
  });

  it.each([
    [{ weight: "" }, "Escribe el peso en kilos."],
    [{ weight: "700" }, "Revisa el peso (0.5 a 400 kg)."],
    [{ weight: "7.0.1" }, "Revisa el peso (0.5 a 400 kg)."],
    [{ height: "17" }, "Revisa la talla (30 a 250 cm)."],
    [{ bodyFatPct: "95" }, "Revisa la grasa corporal (1 a 80 %)."],
    [{ skeletalMuscle: "71" }, "Revisa la masa muscular: no puede pasar del peso."],
    [{ bodyFatKg: "70.5" }, "Revisa la masa grasa: no puede pasar del peso."],
    [{ waistHip: "3" }, "Revisa la relación cintura-cadera (0.40 a 2.00)."],
    [{ visceral: "0" }, "Revisa la grasa visceral (número entero de 1 a 30)."],
    [{ visceral: "8.5" }, "Revisa la grasa visceral (número entero de 1 a 30)."],
    [{ bmr: "6000" }, "Revisa el metabolismo basal (300 a 5000 kcal, sin decimales)."],
    [{ measuredAt: "2026-10-05" }, "La fecha de la medición no puede ser futura."],
    [{ measuredAt: "1999-12-31" }, "Elige la fecha de la medición."],
    [{ note: "x".repeat(1001) }, "La nota es demasiado larga (máximo 1000 caracteres)."],
  ])("refuses %o", (over, message) => {
    expect(parse(over)).toEqual({ ok: false, message });
  });

  it("accepts the range limits themselves", () => {
    expect(parse({ weight: "400", height: "250", visceral: "30", bmr: "300" }).ok).toBe(true);
    expect(parse({ weight: "0.5", skeletalMuscle: "" }).ok).toBe(true);
    expect(parse({ skeletalMuscle: "70" }).ok).toBe(true);
  });
});

describe("form helpers", () => {
  it("keeps one decimal point and turns a comma into a point", () => {
    expect(sanitizeDecimal("68,5")).toBe("68.5");
    expect(sanitizeDecimal("6a8..5")).toBe("68.5");
    expect(sanitizeDecimal("1.2.3")).toBe("1.23");
    expect(sanitizeInteger("1,350 kcal")).toBe("1350");
  });

  it("caps the decimals to what the screen shows for each field", () => {
    // Weight shows one decimal: 70.25 can no longer be typed (it would show
    // as 70.3 while the change against 70.2 said 0.1).
    expect(sanitizeDecimal("70.25", FIELD_DECIMALS.weight)).toBe("70.2");
    expect(sanitizeDecimal("0.885", FIELD_DECIMALS.waistHip)).toBe("0.88");
    expect(sanitizeDecimal("8.5", 0)).toBe("8");
    expect(FIELD_DECIMALS).toMatchObject({ weight: 1, bodyFatPct: 1, waistHip: 2, visceral: 0 });
  });

  it("rounds a value with hidden digits to the shown decimals when saving", () => {
    const result = parse({ weight: "70.25", waistHip: "0.884" });
    expect(result.ok && result.value.weight_kg).toBe(70.3);
    expect(result.ok && result.value.waist_hip_ratio).toBe(0.88);
  });

  it("rounds a pre-filled weight to one decimal", () => {
    expect(emptyMeasurementForm(TODAY, { weight: "70.25", height: "165.04" })).toMatchObject({
      weight: "70.3",
      height: "165",
    });
  });

  it("pre-fills weight and height from the consultation", () => {
    expect(emptyMeasurementForm(TODAY, { weight: " 70.2 ", height: "165" })).toMatchObject({
      measuredAt: TODAY,
      weight: "70.2",
      height: "165",
    });
  });

  it("turns a stored measurement back into the form", () => {
    const stored = {
      id: "m1",
      patient_id: "p1",
      measured_at: "2026-09-01",
      appointment_id: null,
      weight_kg: 70,
      height_cm: null,
      bmi: null,
      body_fat_pct: 30.5,
      body_fat_kg: null,
      skeletal_muscle_kg: null,
      lean_mass_kg: null,
      waist_hip_ratio: 0.88,
      visceral_fat_level: 8,
      bmr_kcal: null,
      balance_upper_lower: null,
      body_type: "promedio",
      cid_type: null,
      note: null,
      created_at: "2026-09-01T16:00:00Z",
    } satisfies BodyMeasurement;
    expect(toMeasurementForm(stored)).toMatchObject({
      measuredAt: "2026-09-01",
      weight: "70",
      height: "",
      bodyFatPct: "30.5",
      waistHip: "0.88",
      visceral: "8",
      bodyType: "promedio",
      note: "",
    });
  });
});
