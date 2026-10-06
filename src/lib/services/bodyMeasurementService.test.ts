import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  createBodyMeasurement,
  deleteBodyMeasurement,
  getWeightTracking,
  listBodyMeasurements,
  setWeightTracking,
  updateBodyMeasurement,
  type BodyMeasurementInput,
} from "./bodyMeasurementService";
import { ANONYMIZED_PATIENT_MESSAGE } from "./patientService";

const input: BodyMeasurementInput = {
  measured_at: "2026-10-04",
  appointment_id: "appt-1",
  weight_kg: 68.5,
  height_cm: 170,
  body_fat_pct: 30.5,
  body_fat_kg: null,
  skeletal_muscle_kg: 26.1,
  lean_mass_kg: null,
  waist_hip_ratio: 0.88,
  visceral_fat_level: 8,
  bmr_kcal: null,
  balance_upper_lower: "equilibrado",
  body_type: null,
  cid_type: "tipo_c",
  note: null,
};

const row = {
  id: "m1",
  patient_id: "p1",
  created_at: "2026-10-04T16:00:00Z",
  bmi: "23.7",
  ...input,
  weight_kg: "68.50",
};

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("listBodyMeasurements", () => {
  it("reads one patient's measurements, oldest first, as numbers", async () => {
    supabaseMock.onFrom("body_measurements", { data: [row] });

    const [m] = await listBodyMeasurements("p1");

    expect(m.weight_kg).toBe(68.5);
    expect(m.bmi).toBe(23.7);
    expect(m.body_fat_kg).toBeNull();
    const query = supabaseMock.queries("body_measurements")[0];
    expect(query.args("eq")).toEqual(["patient_id", "p1"]);
    expect(query.allArgs("order")).toEqual([
      ["measured_at", { ascending: true }],
      ["created_at", { ascending: true }],
    ]);
  });

  it("throws a Spanish message on failure", async () => {
    quiet();
    supabaseMock.onFrom("body_measurements", { error: { message: "denied", code: "42501" } });
    await expect(listBodyMeasurements("p1")).rejects.toThrow(
      "No se pudieron cargar las mediciones.",
    );
  });
});

describe("createBodyMeasurement / updateBodyMeasurement", () => {
  it("inserts the writable columns for the patient, never a BMI or an author", async () => {
    supabaseMock.onFrom("body_measurements", { data: row });

    const saved = await createBodyMeasurement("p1", {
      ...input,
      ...({ bmi: 10, author_id: "x" } as object),
    });

    expect(saved.id).toBe("m1");
    const [payload] = supabaseMock.queries("body_measurements")[0].args("insert") as [
      Record<string, unknown>,
    ];
    expect(payload).toEqual({ patient_id: "p1", ...input });
    expect(payload).not.toHaveProperty("bmi");
    expect(payload).not.toHaveProperty("author_id");
  });

  it("updates one measurement by id without moving it to another patient", async () => {
    supabaseMock.onFrom("body_measurements", { data: row });

    await updateBodyMeasurement("m1", input);

    const query = supabaseMock.queries("body_measurements")[0];
    expect(query.args("eq")).toEqual(["id", "m1"]);
    expect(query.args("update")?.[0]).not.toHaveProperty("patient_id");
  });

  it("shows the database's Spanish reason (anonymized, future date)", async () => {
    quiet();
    supabaseMock.onFrom("body_measurements", {
      error: { code: "P0001", message: "La fecha de la medición no puede ser futura." },
    });
    await expect(createBodyMeasurement("p1", input)).rejects.toThrow(
      "La fecha de la medición no puede ser futura.",
    );
  });

  it("explains a range check and keeps other errors generic", async () => {
    quiet();
    supabaseMock.onFrom(
      "body_measurements",
      { error: { code: "23514", message: "violates check constraint" } },
      { error: { code: "XX000", message: "secret detail" } },
    );
    await expect(createBodyMeasurement("p1", input)).rejects.toThrow(
      "Algún valor está fuera de rango. Revisa la medición.",
    );
    await expect(updateBodyMeasurement("m1", input)).rejects.toThrow(
      "No se pudo guardar la medición. Revisa tu conexión e intenta de nuevo.",
    );
  });

  it("says so when the measurement no longer exists", async () => {
    supabaseMock.onFrom("body_measurements", { data: null });
    await expect(updateBodyMeasurement("m1", input)).rejects.toThrow(
      "Esta medición ya no existe. Recarga el expediente.",
    );
  });
});

describe("deleteBodyMeasurement", () => {
  it("deletes by id and confirms a row was removed", async () => {
    supabaseMock.onFrom("body_measurements", { data: [{ id: "m1" }] });
    await deleteBodyMeasurement("m1");
    const query = supabaseMock.queries("body_measurements")[0];
    expect(query.has("delete")).toBe(true);
    expect(query.args("eq")).toEqual(["id", "m1"]);
  });

  it("reports a delete that removed nothing", async () => {
    supabaseMock.onFrom("body_measurements", { data: [] });
    await expect(deleteBodyMeasurement("m1")).rejects.toThrow(
      "Esta medición ya no existe. Recarga el expediente.",
    );
  });
});

describe("weight tracking flag", () => {
  it("reads patients.weight_tracking; a missing row means off", async () => {
    supabaseMock.onFrom("patients", { data: { weight_tracking: true } }, { data: null });
    await expect(getWeightTracking("p1")).resolves.toBe(true);
    await expect(getWeightTracking("p1")).resolves.toBe(false);
    expect(supabaseMock.queries("patients")[0].args("select")).toEqual(["weight_tracking"]);
  });

  it("writes ONLY weight_tracking, never on an anonymized record", async () => {
    supabaseMock.onFrom("patients", { data: [{ id: "p1" }] });

    await setWeightTracking("p1", true);

    const query = supabaseMock.queries("patients")[0];
    expect(query.args("update")).toEqual([{ weight_tracking: true }]);
    expect(query.args("eq")).toEqual(["id", "p1"]);
    expect(query.args("is")).toEqual(["anonymized_at", null]);
  });

  it("explains that an anonymized record cannot change", async () => {
    supabaseMock.onFrom("patients", { data: [] });
    await expect(setWeightTracking("p1", false)).rejects.toThrow(ANONYMIZED_PATIENT_MESSAGE);
  });

  it("throws Spanish messages on failure", async () => {
    quiet();
    supabaseMock.onFrom("patients", { error: { message: "denied", code: "42501" } });
    await expect(getWeightTracking("p1")).rejects.toThrow(
      "No se pudo saber si el paciente lleva control de peso.",
    );
    await expect(setWeightTracking("p1", true)).rejects.toThrow(
      "No se pudo cambiar el control de peso. Intenta de nuevo.",
    );
  });
});
