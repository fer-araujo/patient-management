import { describe, expect, it } from "vitest";
import {
  EMPTY_VITAL_SIGNS,
  describeVitalSigns,
  parseVitalSigns,
  toVitalSignsForm,
} from "./vitalSigns";

const form = (over: Partial<typeof EMPTY_VITAL_SIGNS>) => ({
  ...EMPTY_VITAL_SIGNS,
  ...over,
});

describe("parseVitalSigns", () => {
  it("stores nothing when nothing was typed", () => {
    expect(parseVitalSigns(EMPTY_VITAL_SIGNS)).toEqual({ ok: true, value: null });
  });

  it("stores the typed values as numbers, leaving out empty ones", () => {
    expect(
      parseVitalSigns(form({ bpSys: "120", bpDia: "80", spo2: "98", weight: "70.5" })),
    ).toEqual({
      ok: true,
      value: { bp_sys: 120, bp_dia: 80, spo2: 98, weight_kg: 70.5 },
    });
  });

  it("keeps the diastolic value (it used to be lost)", () => {
    const parsed = parseVitalSigns(form({ bpSys: "135", bpDia: "85" }));
    expect(parsed).toEqual({ ok: true, value: { bp_sys: 135, bp_dia: 85 } });
  });

  it("asks for both blood pressure numbers", () => {
    expect(parseVitalSigns(form({ bpSys: "120" }))).toEqual({
      ok: false,
      message: "Escribe las dos cifras de la presión arterial.",
    });
  });

  it("rejects typos out of a possible range", () => {
    expect(parseVitalSigns(form({ bpSys: "1200", bpDia: "80" })).ok).toBe(false);
    expect(parseVitalSigns(form({ bpSys: "80", bpDia: "120" })).ok).toBe(false);
    expect(parseVitalSigns(form({ spo2: "101" }))).toEqual({
      ok: false,
      message: "Revisa la oxigenación (50 a 100 %).",
    });
    expect(parseVitalSigns(form({ weight: "7.0.5" })).ok).toBe(false);
    expect(parseVitalSigns(form({ height: "5" })).ok).toBe(false);
  });
});

describe("parseVitalSigns range edges", () => {
  const accepts = (over: Partial<typeof EMPTY_VITAL_SIGNS>) =>
    expect(parseVitalSigns(form(over)).ok).toBe(true);
  const rejects = (over: Partial<typeof EMPTY_VITAL_SIGNS>) =>
    expect(parseVitalSigns(form(over)).ok).toBe(false);

  it("weight: 0.5 to 400 kg", () => {
    accepts({ weight: "0.5" });
    accepts({ weight: "400" });
    rejects({ weight: "0.4" });
    rejects({ weight: "400.1" });
  });

  it("oxygenation: 50 to 100 %", () => {
    accepts({ spo2: "50" });
    accepts({ spo2: "100" });
    rejects({ spo2: "49" });
    rejects({ spo2: "101" });
  });

  it("height: 30 to 250 cm", () => {
    accepts({ height: "30" });
    accepts({ height: "250" });
    rejects({ height: "29" });
    rejects({ height: "251" });
  });

  it("blood pressure: systolic 50 to 260, diastolic 30 to 160 and below the systolic", () => {
    accepts({ bpSys: "50", bpDia: "30" });
    accepts({ bpSys: "260", bpDia: "160" });
    rejects({ bpSys: "49", bpDia: "30" });
    rejects({ bpSys: "120", bpDia: "29" });
    rejects({ bpSys: "261", bpDia: "80" });
    rejects({ bpSys: "200", bpDia: "161" });
    // Diastolic equal to systolic is a typo, not a reading.
    expect(parseVitalSigns(form({ bpSys: "120", bpDia: "120" }))).toEqual({
      ok: false,
      message: "Revisa la presión arterial.",
    });
  });
});

describe("describeVitalSigns", () => {
  it("writes every value in full words, without abbreviations", () => {
    const lines = describeVitalSigns({
      bp_sys: 120,
      bp_dia: 80,
      spo2: 98,
      weight_kg: 70.5,
      height_cm: 165,
    });

    expect(lines).toEqual([
      "Presión arterial 120/80 mmHg",
      "Oxigenación 98 %",
      "Peso 70.5 kg",
      "Talla 165 cm",
    ]);
    expect(lines.join(" ")).not.toMatch(/\bTA\b|SpO2/);
  });

  it("shows nothing when no vital sign was recorded", () => {
    expect(describeVitalSigns(null)).toEqual([]);
  });
});

describe("toVitalSignsForm", () => {
  it("round-trips stored values back into the form", () => {
    const value = { bp_sys: 120, bp_dia: 80, height_cm: 165 };
    expect(parseVitalSigns(toVitalSignsForm(value))).toEqual({ ok: true, value });
  });
});
