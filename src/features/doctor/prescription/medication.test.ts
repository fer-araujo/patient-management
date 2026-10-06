import { describe, expect, it } from "vitest";
import {
  EMPTY_MEDICATION_FORM,
  describeMedicationSchedule,
  isMedicationComplete,
  medicationToForm,
  sameMedication,
  validateMedicationForm,
} from "./medication";
import {
  missingPrescriberItems,
  missingPrintedItems,
  validatePrescriberFields,
} from "./prescriberProfile";
import { EMPTY_PRESCRIBER_PROFILE } from "../../../lib/services/prescriberService";

const complete = {
  ...EMPTY_MEDICATION_FORM,
  nombre: " Ibuprofeno ",
  dosis: "1 tableta",
  via: "Oral",
  frecuencia: "Cada 8 h",
};

describe("validateMedicationForm", () => {
  it("requires medication, dose, route and frequency", () => {
    const result = validateMedicationForm(EMPTY_MEDICATION_FORM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["dosis", "frecuencia", "nombre", "via"]);
  });

  it("refuses a route outside the list and over-long text", () => {
    const result = validateMedicationForm({
      ...complete,
      via: "Nasal",
      indicaciones: "x".repeat(501),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.via).toBe("Elige la vía.");
    expect(result.errors.indicaciones).toBe("Máximo 500 caracteres.");
  });

  it("trims and leaves empty optional fields out", () => {
    const result = validateMedicationForm(complete);
    expect(result).toEqual({
      ok: true,
      value: {
        nombre: "Ibuprofeno",
        dosis: "1 tableta",
        via: "Oral",
        frecuencia: "Cada 8 h",
        indicaciones: "",
      },
    });
  });

  it("keeps presentation and duration when given", () => {
    const result = validateMedicationForm({
      ...complete,
      presentacion: "Tabletas 400 mg",
      duracion: "5 días",
    });
    expect(result.ok && result.value.presentacion).toBe("Tabletas 400 mg");
    expect(result.ok && result.value.duracion).toBe("5 días");
  });
});

describe("medication display", () => {
  it("describes the structured fields and nothing for old items", () => {
    expect(
      describeMedicationSchedule({
        nombre: "Ibuprofeno",
        dosis: "1 tableta",
        indicaciones: "",
        presentacion: "Tabletas 400 mg",
        via: "Oral",
        frecuencia: "Cada 8 h",
        duracion: "por 5 días",
      }),
    ).toBe("Tabletas 400 mg · Vía oral · Cada 8 h · Por 5 días");
    expect(
      describeMedicationSchedule({ nombre: "Hidroquinona", dosis: "4 %", indicaciones: "Noche" }),
    ).toBe("");
  });

  it("compares every field, treating missing as empty", () => {
    const old = { nombre: "A", dosis: "1", indicaciones: "x" };
    expect(sameMedication(old, { ...old, via: "" })).toBe(true);
    expect(sameMedication(old, { ...old, via: "Oral" })).toBe(false);
  });
});

describe("prescriber data", () => {
  it("lists what an official prescription still lacks", () => {
    expect(missingPrescriberItems(EMPTY_PRESCRIBER_PROFILE)).toEqual([
      "Nombre completo",
      "Cédula profesional",
      "Institución que expidió el título",
      "Domicilio del consultorio",
      "Firma",
    ]);
    expect(
      missingPrescriberItems({
        ...EMPTY_PRESCRIBER_PROFILE,
        fullName: "Dra. X",
        cedulaProfesional: "1234567",
        institucionTitulo: "UANL",
        consultorioDomicilio: "Calle 1",
        hasSignature: true,
      }),
    ).toEqual([]);
  });

  it("checks the format of cédulas and phone", () => {
    const errors = validatePrescriberFields({
      fullName: "Dra. X",
      cedulaProfesional: "12AB",
      especialidad: "",
      cedulaEspecialidad: "7654321",
      institucionTitulo: "",
      consultorioDomicilio: "",
      telefono: "<b>",
    });
    expect(errors.cedulaProfesional).toBe("Escribe solo los números de la cédula.");
    expect(errors.especialidad).toBe("Escribe la especialidad de esa cédula.");
    expect(errors.telefono).toBe("Escribe solo números y espacios.");
    // Missing required data is not a format error: it blocks the PDF instead.
    expect(errors.institucionTitulo).toBeUndefined();
  });
});

describe("isMedicationComplete", () => {
  it("needs medication, dose, a known route and a frequency", () => {
    const full = { nombre: "Ibuprofeno", dosis: "1 tableta", via: "Oral", frecuencia: "Cada 8 h", indicaciones: "" };
    expect(isMedicationComplete(full)).toBe(true);
    // Written before migration 25: no route, no frequency.
    expect(isMedicationComplete({ nombre: "Ibuprofeno", dosis: "400 mg", indicaciones: "Cada 8 h" })).toBe(false);
    expect(isMedicationComplete({ ...full, via: "  " })).toBe(false);
    expect(isMedicationComplete({ ...full, via: "Nasal" })).toBe(false);
    expect(isMedicationComplete({ ...full, frecuencia: " " })).toBe(false);
    expect(isMedicationComplete({ ...full, dosis: "" })).toBe(false);
  });

  it("prefills the form with what the old item has, leaving an unknown route empty", () => {
    expect(
      medicationToForm({ nombre: " Ibuprofeno ", dosis: "400 mg", indicaciones: "Cada 8 h", via: "Nasal" }),
    ).toEqual({
      ...EMPTY_MEDICATION_FORM,
      nombre: "Ibuprofeno",
      dosis: "400 mg",
      indicaciones: "Cada 8 h",
    });
  });
});

describe("missingPrintedItems", () => {
  it("checks only the printed fields (the snapshot's signature is checked apart)", () => {
    expect(missingPrintedItems(EMPTY_PRESCRIBER_PROFILE)).toEqual([
      "Nombre completo",
      "Cédula profesional",
      "Institución que expidió el título",
      "Domicilio del consultorio",
    ]);
    expect(missingPrescriberItems(EMPTY_PRESCRIBER_PROFILE).at(-1)).toBe("Firma");
  });
});
