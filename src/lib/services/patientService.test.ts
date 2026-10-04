import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  ANONYMIZED_PATIENT_MESSAGE,
  fetchPatientDetails,
  updatePatientDetails,
  type PatientDetailsFields,
} from "./patientService";

const fields = (extra: Partial<PatientDetailsFields> = {}): PatientDetailsFields => ({
  first_name: " María ",
  last_name: "González",
  phone: "+52 55 1234 5678",
  email: "maria@ejemplo.com",
  gender: "Femenino",
  dob: "1960-04-12",
  blood_type: "O-",
  allergies: "",
  chronic_conditions: "Diabetes",
  ...extra,
});

const updated = { data: [{ id: "p1" }] };

describe("fetchPatientDetails", () => {
  it("reads the personal-data columns of one patient", async () => {
    supabaseMock.onFrom("patients", {
      data: { id: "p1", first_name: "María", blood_type: "o−", anonymized_at: null },
    });

    const patient = await fetchPatientDetails("p1");

    expect(patient.first_name).toBe("María");
    expect(patient.blood_type).toBe("O-");
    const query = supabaseMock.queries("patients")[0];
    expect(query.args("eq")).toEqual(["id", "p1"]);
    expect(String(query.args("select")?.[0])).toContain("anonymized_at");
  });

  it("reports a missing patient in Spanish", async () => {
    supabaseMock.onFrom("patients", { data: null });
    await expect(fetchPatientDetails("nope")).rejects.toThrow(
      "No encontramos a este paciente.",
    );
  });
});

describe("updatePatientDetails", () => {
  it("sends only the allowed columns, trimmed, with the phone in E.164", async () => {
    supabaseMock.onFrom("patients", updated);
    const withExtras = {
      ...fields(),
      status: "archived",
      notes: "x",
      anonymized_at: null,
    } as PatientDetailsFields;

    await updatePatientDetails("p1", withExtras);

    const query = supabaseMock.queries("patients")[0];
    expect(query.args("update")?.[0]).toEqual({
      first_name: "María",
      last_name: "González",
      phone: "+525512345678",
      email: "maria@ejemplo.com",
      gender: "Femenino",
      dob: "1960-04-12",
      blood_type: "O-",
      allergies: null,
      chronic_conditions: "Diabetes",
    });
    expect(query.args("eq")).toEqual(["id", "p1"]);
    expect(query.args("is")).toEqual(["anonymized_at", null]);
  });

  it("drops the legacy MX mobile 1 and keeps US numbers", async () => {
    supabaseMock.onFrom("patients", updated);

    await updatePatientDetails("p1", fields({ phone: "+5215512345678" }));
    await updatePatientDetails("p1", fields({ phone: "+1 212 555 0101" }));

    const [mx, us] = supabaseMock.queries("patients");
    expect((mx.args("update")?.[0] as PatientDetailsFields).phone).toBe("+525512345678");
    expect((us.args("update")?.[0] as PatientDetailsFields).phone).toBe("+12125550101");
  });

  it("refuses an invalid phone, gender or blood type without calling the server", async () => {
    await expect(updatePatientDetails("p1", fields({ phone: "55 1234" }))).rejects.toThrow(
      "Ingresa un teléfono válido a 10 dígitos.",
    );
    await expect(updatePatientDetails("p1", fields({ gender: "M" }))).rejects.toThrow(
      "Elige un género de la lista.",
    );
    await expect(updatePatientDetails("p1", fields({ blood_type: "Z+" }))).rejects.toThrow(
      "Elige un tipo de sangre de la lista.",
    );
    await expect(updatePatientDetails("p1", fields({ first_name: "  " }))).rejects.toThrow(
      "Escribe el nombre del paciente.",
    );
    expect(supabaseMock.queries("patients")).toHaveLength(0);
  });

  it("maps a duplicate phone (23505) to a clear message", async () => {
    supabaseMock.onFrom("patients", {
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    await expect(updatePatientDetails("p1", fields())).rejects.toThrow(
      "Ya existe un paciente con ese número de teléfono.",
    );
  });

  it("surfaces other errors in Spanish without logging the server message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("patients", {
      error: { code: "XX000", message: "secret detail about +525512345678" },
    });

    await expect(updatePatientDetails("p1", fields())).rejects.toThrow(
      "No se pudieron guardar los datos del paciente.",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("+525512345678");
  });

  it("refuses an anonymized patient (no row updated)", async () => {
    supabaseMock.onFrom("patients", { data: [] });

    await expect(updatePatientDetails("p1", fields())).rejects.toThrow(
      ANONYMIZED_PATIENT_MESSAGE,
    );
  });
});
