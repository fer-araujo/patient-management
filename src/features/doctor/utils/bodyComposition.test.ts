import { describe, expect, it } from "vitest";
import {
  classifyLevel,
  describeChange,
  formatMeasurementDate,
  formatWithUnit,
  markerPosition,
  referenceScale,
  sexFromGender,
  zoneWidths,
  type IndicatorKey,
  type BodySex,
  type LevelZone,
} from "./bodyComposition";

const level = (key: IndicatorKey, sex: BodySex, value: number): LevelZone | null => {
  const scale = referenceScale(key, sex);
  return scale ? classifyLevel(value, scale) : null;
};

describe("sexFromGender", () => {
  it.each([
    ["Femenino", "female"],
    ["Masculino", "male"],
    [" femenino ", "female"],
    ["Otro", null],
    [null, null],
    [undefined, null],
  ])("reads %s as %s", (gender, sex) => {
    expect(sexFromGender(gender)).toBe(sex);
  });
});

describe("BMI levels (WHO)", () => {
  it.each([
    [18.4, "low"],
    [18.5, "normal"],
    [24.9, "normal"],
    [25, "high"],
    [32.1, "high"],
  ] as const)("%s kg/m² is %s for any sex", (value, expected) => {
    expect(level("bmi", "female", value)).toBe(expected);
    expect(level("bmi", "male", value)).toBe(expected);
    expect(level("bmi", null, value)).toBe(expected);
  });
});

describe("body fat % levels (by sex)", () => {
  it.each([
    ["male", 9.9, "low"],
    ["male", 10, "normal"],
    ["male", 20, "normal"],
    ["male", 20.1, "high"],
    ["female", 17.9, "low"],
    ["female", 18, "normal"],
    ["female", 28, "normal"],
    ["female", 28.1, "high"],
  ] as const)("%s at %s %% is %s", (sex, value, expected) => {
    expect(level("body_fat_pct", sex, value)).toBe(expected);
  });

  it("shows no range when the sex is unknown", () => {
    expect(referenceScale("body_fat_pct", null)).toBeNull();
  });

  it("the same value reads differently by sex", () => {
    expect(level("body_fat_pct", "male", 25)).toBe("high");
    expect(level("body_fat_pct", "female", 25)).toBe("normal");
  });
});

describe("visceral fat level", () => {
  it.each([
    [1, "normal"],
    [9, "normal"],
    [10, "high"],
    [20, "high"],
  ] as const)("level %s is %s", (value, expected) => {
    expect(level("visceral_fat_level", null, value)).toBe(expected);
  });

  it("has no low zone", () => {
    const scale = referenceScale("visceral_fat_level", null)!;
    expect(zoneWidths(scale).low).toBe(0);
  });
});

describe("waist-hip ratio (WHO, by sex)", () => {
  it.each([
    ["male", 0.9, "normal"],
    ["male", 0.91, "high"],
    ["female", 0.85, "normal"],
    ["female", 0.86, "high"],
    ["female", 0.7, "normal"],
  ] as const)("%s at %s is %s", (sex, value, expected) => {
    expect(level("waist_hip_ratio", sex, value)).toBe(expected);
  });

  it("shows no range when the sex is unknown", () => {
    expect(referenceScale("waist_hip_ratio", null)).toBeNull();
  });
});

describe("indicators without a reliable range", () => {
  it.each(["weight_kg", "skeletal_muscle_kg", "body_fat_kg", "lean_mass_kg", "bmr_kcal"] as const)(
    "%s shows value and trend only",
    (key) => {
      expect(referenceScale(key, "female")).toBeNull();
      expect(referenceScale(key, "male")).toBeNull();
    },
  );
});

describe("level bar geometry", () => {
  it("splits the BMI bar into proportional zones that add up to the whole bar", () => {
    const widths = zoneWidths(referenceScale("bmi", null)!);
    expect(widths.low).toBeCloseTo(8.5 / 30);
    expect(widths.normal).toBeCloseTo(6.4 / 30);
    expect(widths.low + widths.normal + widths.high).toBeCloseTo(1);
  });

  it("places the marker on the bar and clamps values beyond its ends", () => {
    const scale = referenceScale("bmi", null)!;
    expect(markerPosition(25, scale)).toBeCloseTo(0.5);
    expect(markerPosition(5, scale)).toBe(0);
    expect(markerPosition(55, scale)).toBe(1);
  });
});

describe("describeChange", () => {
  it("says how much it went up or down, with the unit", () => {
    expect(describeChange(70.5, 72, "weight_kg")).toEqual({
      direction: "down",
      amount: 1.5,
      text: "▼ 1.5 kg",
    });
    expect(describeChange(31, 30.5, "body_fat_pct").text).toBe("▲ 0.5 %");
    expect(describeChange(0.88, 0.9, "waist_hip_ratio").text).toBe("▼ 0.02");
  });

  it("ignores floating point noise below the indicator's precision", () => {
    expect(describeChange(70.1 + 0.2, 70.3, "weight_kg")).toEqual({
      direction: "same",
      amount: 0,
      text: "Sin cambio",
    });
  });
});

describe("formatting", () => {
  it("uses the indicator's decimals and unit", () => {
    expect(formatWithUnit(68.5, "weight_kg")).toBe("68.5 kg");
    expect(formatWithUnit(8, "visceral_fat_level")).toBe("8");
    expect(formatWithUnit(1350, "bmr_kcal")).toBe("1,350 kcal");
  });

  it("formats a clinic date on its own day in any browser zone", () => {
    expect(formatMeasurementDate("2026-10-01")).toBe("1 oct 2026");
    expect(formatMeasurementDate("2026-10-01", false)).toBe("1 de octubre de 2026");
  });
});
