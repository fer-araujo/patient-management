import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  createAppointment,
  fetchDoctorAppointments,
  recordPastVisit,
  rescheduleAppointment,
} from "./clinicService";

const SLOT_TAKEN = "El horario seleccionado acaba de ocuparse. Por favor elige otro.";

beforeEach(() => {
  // The service logs every failure; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fetchDoctorAppointments", () => {
  it("reads each patient's status, so an archived patient can be left out of booking", async () => {
    supabaseMock.onFrom("appointments", {
      data: [
        {
          id: "a-rosa",
          start_time: "2026-10-16T14:00:00.000Z",
          status: "completed",
          patient_id: "p-rosa",
          reason: null,
          patients: { first_name: "Rosa", last_name: "Ruiz", phone: "+528100000000", status: "archived" },
          services: { name: "Toxina", duration_mins: 30, price: 500 },
        },
      ],
    });

    const [appointment] = await fetchDoctorAppointments();

    expect(appointment.patientStatus).toBe("archived");
    expect(String(supabaseMock.queries("appointments")[0].args("select")?.[0])).toMatch(
      /patients \(\s*first_name,\s*last_name,\s*phone,\s*status\s*\)/,
    );
  });
});

describe("fetchDoctorAppointments suppliesPending", () => {
  const row = (id: string, over: Record<string, unknown>) => ({
    id,
    start_time: "2026-10-16T14:00:00.000Z",
    status: "completed",
    patient_id: "p-rosa",
    service_id: "svc-relleno",
    reason: null,
    patients: { first_name: "Rosa", last_name: "Ruiz", phone: "+528100000000", status: "active" },
    services: { name: "Relleno", duration_mins: 30, price: 500, service_supplies: [{ item_id: "item-s" }] },
    clinical_notes: [{ finalized_at: "2026-10-16T15:00:00Z", supplies_recorded_at: null }],
    ...over,
  });

  it("flags only finalized consultations of a service with supplies whose supplies were never recorded", async () => {
    supabaseMock.onFrom("appointments", {
      data: [
        row("pending-supplies", {}),
        row("recorded", {
          clinical_notes: [{ finalized_at: "2026-10-16T15:00:00Z", supplies_recorded_at: "2026-10-16T15:00:00Z" }],
        }),
        row("draft-only", { clinical_notes: [{ finalized_at: null, supplies_recorded_at: null }] }),
        row("no-supplies-configured", {
          services: { name: "Valoración", duration_mins: 30, price: 500, service_supplies: [] },
        }),
        row("cancelled", { status: "cancelled" }),
        // A past visit transcribed from paper: completed, no note at all.
        row("past-visit", { clinical_notes: [] }),
      ],
    });

    const list = await fetchDoctorAppointments();

    expect(list.filter((a) => a.suppliesPending).map((a) => a.id)).toEqual(["pending-supplies"]);
    expect(list[0].serviceId).toBe("svc-relleno");
    const select = String(supabaseMock.queries("appointments")[0].args("select")?.[0]);
    expect(select).toContain("clinical_notes ( finalized_at, supplies_recorded_at )");
    expect(select).toContain("service_supplies ( item_id )");
  });
});

describe("createAppointment", () => {
  it("books through staff_create_appointment with the catalog service id and the UTC start", async () => {
    await createAppointment("p-marta", "srv-toxina", "16 oct 2026", "08:00 AM");

    // The id comes from the active catalog: no lookup by name.
    expect(supabaseMock.queries("services")).toHaveLength(0);
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

  it("passes the server's Spanish message through for a P0001 error", async () => {
    supabaseMock.onRpc("staff_create_appointment", {
      error: { code: "P0001", message: SLOT_TAKEN },
    });

    await expect(
      createAppointment("p-marta", "srv-toxina", "16 oct 2026", "08:00 AM"),
    ).rejects.toThrow(SLOT_TAKEN);
  });

  it("passes through the refusal of a service that is not in the catalog", async () => {
    const missing = "El servicio seleccionado no existe en el catálogo.";
    supabaseMock.onRpc("staff_create_appointment", {
      error: { code: "P0001", message: missing },
    });

    await expect(
      createAppointment("p-marta", "srv-borrado", "16 oct 2026", "08:00 AM"),
    ).rejects.toThrow(missing);
  });

  it("hides any other error behind a generic message", async () => {
    supabaseMock.onRpc("staff_create_appointment", {
      error: { code: "42501", message: "permission denied for function staff_create_appointment" },
    });

    await expect(
      createAppointment("p-marta", "srv-toxina", "16 oct 2026", "08:00 AM"),
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

describe("recordPastVisit", () => {
  // Thursday 15 Oct 2026, 11:10 AM in Monterrey (UTC-6).
  const NOW = new Date("2026-10-15T17:10:00.000Z").getTime();
  const base = {
    patientId: "p-ana",
    serviceId: "srv-toxina",
    isoDate: "2026-10-15",
    time: "10:00 AM",
  } as const;

  it("records a paid visit and its charge in one call, with the clinic-time start", async () => {
    supabaseMock.onRpc("staff_record_past_visit", { data: "appt-new" });

    const id = await recordPastVisit(
      { ...base, paymentStatus: "paid", amount: 1200, method: "card", note: "  Pagó completo " },
      NOW,
    );

    expect(id).toBe("appt-new");
    expect(supabaseMock.lastRpc("staff_record_past_visit")?.args).toEqual({
      p_patient_id: "p-ana",
      p_service_id: "srv-toxina",
      p_start_time: "2026-10-15T16:00:00.000Z",
      p_payment_status: "paid",
      p_amount: 1200,
      p_method: "card",
      p_note: "Pagó completo",
    });
    expect(supabaseMock.queries("appointments")).toHaveLength(0);
    expect(supabaseMock.rpcCalls("record_payment")).toHaveLength(0);
  });

  it("sends a courtesy as 0 with no method, whatever the form held", async () => {
    supabaseMock.onRpc("staff_record_past_visit", { data: "appt-new" });

    await recordPastVisit(
      { ...base, paymentStatus: "courtesy", amount: 900, method: "cash" },
      NOW,
    );

    expect(supabaseMock.lastRpc("staff_record_past_visit")?.args).toMatchObject({
      p_payment_status: "courtesy",
      p_amount: 0,
      p_method: null,
      p_note: null,
    });
  });

  it("accepts a time already passed today and refuses one that has not come yet", async () => {
    supabaseMock.onRpc("staff_record_past_visit", { data: "appt-new" });

    await expect(
      recordPastVisit({ ...base, time: "11:00 AM", paymentStatus: "courtesy" }, NOW),
    ).resolves.toBe("appt-new");

    await expect(
      recordPastVisit({ ...base, time: "11:15 AM", paymentStatus: "courtesy" }, NOW),
    ).rejects.toThrow("Esa hora todavía no pasa. Usa Agendar Cita para citas futuras.");
    expect(supabaseMock.rpcCalls("staff_record_past_visit")).toHaveLength(1);
  });

  it("asks for the amount and the method of a paid visit before calling the server", async () => {
    await expect(
      recordPastVisit({ ...base, paymentStatus: "paid", amount: 0, method: "cash" }, NOW),
    ).rejects.toThrow("Indica cuánto cobraste (más de 0).");
    await expect(
      recordPastVisit({ ...base, paymentStatus: "paid", amount: 500, method: null }, NOW),
    ).rejects.toThrow("Indica cómo te pagaron.");
    await expect(
      recordPastVisit({ ...base, patientId: "", paymentStatus: "courtesy" }, NOW),
    ).rejects.toThrow("Elige el paciente.");
    expect(supabaseMock.rpcCalls("staff_record_past_visit")).toHaveLength(0);
  });

  it("passes the server's Spanish refusal through and hides anything else", async () => {
    supabaseMock.onRpc("staff_record_past_visit", {
      error: { message: "Ya hay una cita o un bloqueo en ese horario. Revisa la hora.", code: "P0001" },
    });
    await expect(
      recordPastVisit({ ...base, paymentStatus: "courtesy" }, NOW),
    ).rejects.toThrow("Ya hay una cita o un bloqueo en ese horario. Revisa la hora.");

    supabaseMock.onRpc("staff_record_past_visit", {
      error: { message: "permission denied", code: "42501" },
    });
    await expect(
      recordPastVisit({ ...base, paymentStatus: "courtesy" }, NOW),
    ).rejects.toThrow("No se pudo guardar la cita pasada.");
  });
});
