import { describe, expect, it } from "vitest";
import { ageFromDob, describeAgeAndSex } from "./patientIdentity";

const today = new Date(2026, 8, 27); // 27 Sep 2026, local

describe("ageFromDob", () => {
  it("counts whole years, turning one year older on the birthday", () => {
    expect(ageFromDob("1958-09-27", today)).toBe(68);
    expect(ageFromDob("1958-09-28", today)).toBe(67);
    expect(ageFromDob("1958-10-01", today)).toBe(67);
  });

  it("reads the date as local, not UTC midnight", () => {
    // As UTC midnight "1958-09-28" is still the 27th in Monterrey.
    expect(ageFromDob("1958-09-28", today)).toBe(67);
  });

  it("a Feb 29 birthday turns a year older on Mar 1 in a non-leap year", () => {
    expect(ageFromDob("2000-02-29", new Date(2026, 1, 28))).toBe(25);
    expect(ageFromDob("2000-02-29", new Date(2026, 2, 1))).toBe(26);
    // In a leap year, on the day itself.
    expect(ageFromDob("2000-02-29", new Date(2028, 1, 29))).toBe(28);
  });

  it("returns null for a missing, malformed or future date", () => {
    expect(ageFromDob(null, today)).toBeNull();
    expect(ageFromDob("28/09/1958", today)).toBeNull();
    expect(ageFromDob("2030-01-01", today)).toBeNull();
  });
});

describe("describeAgeAndSex", () => {
  it("joins age and sex", () => {
    expect(describeAgeAndSex("1958-09-27", "Femenino", today)).toBe("68 años · Femenino");
    expect(describeAgeAndSex("2025-09-01", "Masculino", today)).toBe("1 año · Masculino");
  });

  it("says plainly what is missing", () => {
    expect(describeAgeAndSex(undefined, "", today)).toBe(
      "Edad sin registrar · Sexo sin registrar",
    );
  });
});
