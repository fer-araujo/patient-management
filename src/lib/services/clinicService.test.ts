import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import { createAppointment, rescheduleAppointment } from "./clinicService";

const SLOT_TAKEN = "El horario seleccionado acaba de ocuparse. Por favor elige otro.";

beforeEach(() => {
  // The service logs every failure; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createAppointment", () => {
  it("books through staff_create_appointment with the service id and the UTC start", async () => {
    supabaseMock.onFrom("services", { data: { id: "srv-toxina" } });

    await createAppointment("p-marta", "Toxina", "16 oct 2026", "08:00 AM");

    const lookup = supabaseMock.queries("services")[0];
    expect(lookup.args("eq")).toEqual(["name", "Toxina"]);
    expect(supabaseMock.rpcCalls()).toEqual([
      {
        name: "staff_create_appointment",
        args: {
          p_patient_id: "p-marta",
          p_service_id: "srv-toxina",
          // 08:00 AM in Monterrey (UTC-6).
          p_start_time: "2026-10-16T14:00:00.000Z",
        },
      },
    ]);
    // Never a direct write to the table.
    expect(supabaseMock.queries("appointments")).toHaveLength(0);
  });

  it("does not call the RPC when the service is not in the catalog", async () => {
    supabaseMock.onFrom("services", { data: null, error: { message: "0 rows" } });

    await expect(
      createAppointment("p-marta", "Borrado", "16 oct 2026", "08:00 AM"),
    ).rejects.toThrow("El servicio seleccionado no existe en el catálogo.");
    expect(supabaseMock.rpcCalls()).toHaveLength(0);
  });

  it("passes the server's Spanish message through for a P0001 error", async () => {
    supabaseMock.onFrom("services", { data: { id: "srv-toxina" } });
    supabaseMock.onRpc("staff_create_appointment", {
      error: { code: "P0001", message: SLOT_TAKEN },
    });

    await expect(
      createAppointment("p-marta", "Toxina", "16 oct 2026", "08:00 AM"),
    ).rejects.toThrow(SLOT_TAKEN);
  });

  it("hides any other error behind a generic message", async () => {
    supabaseMock.onFrom("services", { data: { id: "srv-toxina" } });
    supabaseMock.onRpc("staff_create_appointment", {
      error: { code: "42501", message: "permission denied for function staff_create_appointment" },
    });

    await expect(
      createAppointment("p-marta", "Toxina", "16 oct 2026", "08:00 AM"),
    ).rejects.toThrow(/^No se pudo agendar la cita\.$/);
  });
});

describe("rescheduleAppointment", () => {
  it("moves the appointment through staff_reschedule_appointment", async () => {
    await rescheduleAppointment("a-ana", "2026-10-16T15:30:00.000Z");

    expect(supabaseMock.rpcCalls()).toEqual([
      {
        name: "staff_reschedule_appointment",
        args: {
          p_appointment_id: "a-ana",
          p_start_time: "2026-10-16T15:30:00.000Z",
        },
      },
    ]);
    expect(supabaseMock.queries("appointments")).toHaveLength(0);
  });

  it("passes the server's Spanish message through for a P0001 error", async () => {
    supabaseMock.onRpc("staff_reschedule_appointment", {
      error: { code: "P0001", message: SLOT_TAKEN },
    });

    await expect(
      rescheduleAppointment("a-ana", "2026-10-16T15:30:00.000Z"),
    ).rejects.toThrow(SLOT_TAKEN);
  });

  it("hides any other error behind a generic message", async () => {
    supabaseMock.onRpc("staff_reschedule_appointment", {
      error: { message: "network down" },
    });

    await expect(
      rescheduleAppointment("a-ana", "2026-10-16T15:30:00.000Z"),
    ).rejects.toThrow(/^No se pudo reprogramar la cita\.$/);
  });
});
