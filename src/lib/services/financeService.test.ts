import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  fetchPayment,
  getFinanceSummary,
  getPeriodRange,
  monthKeyOf,
  recordPayment,
} from "./financeService";

const paymentRow = {
  id: "pay-1",
  appointment_id: "appt-1",
  patient_id: "patient-1",
  service_id: "svc-1",
  list_price: "800.00",
  amount_charged: "750.00",
  status: "paid",
  method: "cash",
  note: null,
  created_at: "2026-09-10T16:00:00+00:00",
  updated_at: "2026-09-10T16:00:00+00:00",
};

describe("recordPayment", () => {
  it("sends a paid charge with its amount and method, and maps the stored row", async () => {
    supabaseMock.onRpc("record_payment", { data: paymentRow });

    const payment = await recordPayment({
      appointmentId: "appt-1",
      status: "paid",
      amount: 750,
      method: "cash",
      note: "  Pagó en dos partes ",
    });

    expect(supabaseMock.lastRpc("record_payment")?.args).toEqual({
      p_appointment_id: "appt-1",
      p_status: "paid",
      p_amount: 750,
      p_method: "cash",
      p_note: "Pagó en dos partes",
    });
    expect(payment).toMatchObject({
      id: "pay-1",
      appointmentId: "appt-1",
      amountCharged: 750,
      listPrice: 800,
      status: "paid",
      method: "cash",
    });
  });

  it("sends a courtesy as amount 0 with no method, whatever the form held", async () => {
    supabaseMock.onRpc("record_payment", {
      data: { ...paymentRow, status: "courtesy", amount_charged: "0.00", method: null },
    });

    await recordPayment({ appointmentId: "appt-1", status: "courtesy", amount: 500, method: "card" });

    expect(supabaseMock.lastRpc("record_payment")?.args).toEqual({
      p_appointment_id: "appt-1",
      p_status: "courtesy",
      p_amount: 0,
      p_method: null,
      p_note: null,
    });
  });

  it("refuses a paid charge without an amount or a method before calling the server", async () => {
    await expect(
      recordPayment({ appointmentId: "appt-1", status: "paid", amount: 0, method: "cash" }),
    ).rejects.toThrow("Indica cuánto cobraste");
    await expect(
      recordPayment({ appointmentId: "appt-1", status: "paid", amount: 100 }),
    ).rejects.toThrow("Indica cómo te pagaron");
    expect(supabaseMock.rpcCalls("record_payment")).toHaveLength(0);
  });

  it("shows the server's own message for P0001 and a generic one otherwise", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("record_payment", {
      error: { code: "P0001", message: "No se encontró la cita." },
    });
    await expect(
      recordPayment({ appointmentId: "x", status: "courtesy" }),
    ).rejects.toThrow("No se encontró la cita.");

    supabaseMock.onRpc("record_payment", {
      error: { code: "42501", message: "permission denied for function record_payment" },
    });
    await expect(
      recordPayment({ appointmentId: "x", status: "courtesy" }),
    ).rejects.toThrow("No se pudo guardar el cobro.");
  });
});

describe("fetchPayment", () => {
  it("reads the payment of one appointment", async () => {
    supabaseMock.onFrom("payments", { data: paymentRow });

    await expect(fetchPayment("appt-1")).resolves.toMatchObject({
      id: "pay-1",
      amountCharged: 750,
    });
    const query = supabaseMock.queries("payments")[0];
    expect(query.args("eq")).toEqual(["appointment_id", "appt-1"]);
    expect(query.has("maybeSingle")).toBe(true);
  });

  it("returns null when nothing was charged yet", async () => {
    await expect(fetchPayment("appt-2")).resolves.toBeNull();
  });
});

describe("getPeriodRange", () => {
  const now = new Date(2026, 8, 25, 10, 0); // 25 Sep 2026, Monterrey

  it("covers whole clinic-time months and years (to is exclusive)", () => {
    expect(getPeriodRange("this_month", now)).toEqual({ from: "2026-09-01", to: "2026-10-01" });
    expect(getPeriodRange("last_month", now)).toEqual({ from: "2026-08-01", to: "2026-09-01" });
    expect(getPeriodRange("this_year", now)).toEqual({ from: "2026-01-01", to: "2027-01-01" });
  });

  it("crosses the year boundary", () => {
    const january = new Date(2027, 0, 5);
    expect(getPeriodRange("last_month", january)).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    const december = new Date(2026, 11, 31);
    expect(getPeriodRange("this_month", december)).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
});

describe("getFinanceSummary", () => {
  const payments = [
    {
      id: "p1", status: "paid", amount_charged: "800.00", list_price: "800.00",
      created_at: "2026-09-10T16:00:00+00:00",
      services: { name: "Toxina" }, patients: { first_name: "Ana", last_name: "Pérez" },
    },
    {
      id: "p2", status: "paid", amount_charged: "500.00", list_price: "900.00",
      created_at: "2026-09-12T16:00:00+00:00",
      services: { name: "Valoración" }, patients: { first_name: "Luis", last_name: "Gómez" },
    },
    {
      id: "p3", status: "courtesy", amount_charged: "0.00", list_price: "900.00",
      created_at: "2026-09-13T16:00:00+00:00",
      services: { name: "Valoración" }, patients: { first_name: "Eva", last_name: "Ruiz" },
    },
    {
      id: "p4", status: "courtesy", amount_charged: "0.00", list_price: null,
      created_at: "2026-09-14T16:00:00+00:00",
      services: null, patients: null,
    },
  ];
  const purchases = [
    { id: "m1", quantity: 10, total_cost: "1200.00", created_at: "2026-09-11T16:00:00+00:00", inventory: { name: "Jeringas" } },
    { id: "m2", quantity: 2, total_cost: "400.00", created_at: "2026-09-15T16:00:00+00:00", inventory: { name: "Gasas" } },
  ];

  it("sums income, expenses, a NEGATIVE profit and the value of courtesies", async () => {
    supabaseMock.onFrom("payments", { data: payments });
    supabaseMock.onFrom("inventory_movements", { data: purchases });

    const summary = await getFinanceSummary("2026-09-01", "2026-10-01");

    expect(summary.income).toBe(1300);
    expect(summary.expenses).toBe(1600);
    expect(summary.profit).toBe(-300);
    expect(summary.courtesyCount).toBe(2);
    // Only the courtesy with a list price adds to the forgone value.
    expect(summary.forgoneValue).toBe(900);
    expect(summary.incomeByService).toEqual([
      { service: "Toxina", total: 800, count: 1 },
      { service: "Valoración", total: 500, count: 1 },
    ]);
    expect(summary.monthly).toEqual([
      { month: "2026-09", income: 1300, courtesy: 900, expenses: 1600 },
    ]);
  });

  it("queries the Monterrey-day range in UTC and only purchases as expenses", async () => {
    await getFinanceSummary("2026-09-01", "2026-10-01");

    const paymentsQuery = supabaseMock.queries("payments")[0];
    expect(paymentsQuery.args("gte")).toEqual(["created_at", "2026-09-01T06:00:00.000Z"]);
    expect(paymentsQuery.args("lt")).toEqual(["created_at", "2026-10-01T06:00:00.000Z"]);

    const purchasesQuery = supabaseMock.queries("inventory_movements")[0];
    expect(purchasesQuery.args("eq")).toEqual(["type", "purchase"]);
    expect(purchasesQuery.args("gte")).toEqual(["created_at", "2026-09-01T06:00:00.000Z"]);
    expect(purchasesQuery.args("lt")).toEqual(["created_at", "2026-10-01T06:00:00.000Z"]);
  });

  it("buckets by Monterrey month, not by UTC month, and keeps empty months", async () => {
    supabaseMock.onFrom("payments", {
      data: [
        {
          // 30 Sep 21:00 in Monterrey, already 1 Oct in UTC.
          id: "late", status: "paid", amount_charged: "300.00", list_price: null,
          created_at: "2026-10-01T03:00:00+00:00", services: { name: "Toxina" }, patients: null,
        },
      ],
    });
    supabaseMock.onFrom("inventory_movements", {
      data: [
        // 1 Oct 00:00 in Monterrey.
        { id: "early", quantity: 1, total_cost: "50.00", created_at: "2026-10-01T06:00:00+00:00", inventory: null },
      ],
    });

    const summary = await getFinanceSummary("2026-08-01", "2026-11-01");

    expect(summary.monthly).toEqual([
      { month: "2026-08", income: 0, courtesy: 0, expenses: 0 },
      { month: "2026-09", income: 300, courtesy: 0, expenses: 0 },
      { month: "2026-10", income: 0, courtesy: 0, expenses: 50 },
    ]);
    expect(monthKeyOf("2026-10-01T03:00:00+00:00")).toBe("2026-09");
  });

  it("adds each courtesy's list price to its Monterrey month, never to expenses or profit", async () => {
    supabaseMock.onFrom("payments", {
      data: [
        {
          id: "c-sep", status: "courtesy", amount_charged: "0.00", list_price: "900.00",
          // 30 Sep 22:00 in Monterrey, already 1 Oct in UTC.
          created_at: "2026-10-01T04:00:00+00:00", services: { name: "Valoración" }, patients: null,
        },
        {
          id: "c-oct", status: "courtesy", amount_charged: "0.00", list_price: "450.50",
          created_at: "2026-10-10T16:00:00+00:00", services: { name: "Plasma" }, patients: null,
        },
        {
          id: "paid-oct", status: "paid", amount_charged: "1000.00", list_price: "1000.00",
          created_at: "2026-10-11T16:00:00+00:00", services: { name: "Toxina" }, patients: null,
        },
      ],
    });
    supabaseMock.onFrom("inventory_movements", {
      data: [
        { id: "buy", quantity: 1, total_cost: "200.00", created_at: "2026-10-12T16:00:00+00:00", inventory: null },
      ],
    });

    const summary = await getFinanceSummary("2026-09-01", "2026-11-01");

    expect(summary.monthly).toEqual([
      { month: "2026-09", income: 0, courtesy: 900, expenses: 0 },
      { month: "2026-10", income: 1000, courtesy: 450.5, expenses: 200 },
    ]);
    expect(summary.forgoneValue).toBe(1350.5);
    expect(summary.expenses).toBe(200);
    // Profit is income minus supply spending only: 1000 - 200.
    expect(summary.profit).toBe(800);
  });

  it("lists movements newest first with signed amounts", async () => {
    supabaseMock.onFrom("payments", { data: payments });
    supabaseMock.onFrom("inventory_movements", { data: purchases });

    const { movements } = await getFinanceSummary("2026-09-01", "2026-10-01", {
      includePatientNames: true,
    });

    expect(movements.map((m) => [m.id, m.kind, m.amount])).toEqual([
      ["m2", "purchase", -400],
      ["p4", "courtesy", 0],
      ["p3", "courtesy", 0],
      ["p2", "payment", 500],
      ["m1", "purchase", -1200],
      ["p1", "payment", 800],
    ]);
    expect(movements.find((m) => m.id === "p1")?.concept).toBe("Toxina · Ana Pérez");
    expect(movements.find((m) => m.id === "m1")?.concept).toBe("Jeringas (10)");
  });

  it("asks for the patient's name only when the doctor's view needs it", async () => {
    await getFinanceSummary("2026-09-01", "2026-10-01", { includePatientNames: true });
    await getFinanceSummary("2026-09-01", "2026-10-01");

    const [doctorQuery, defaultQuery] = supabaseMock.queries("payments");
    expect(String(doctorQuery.args("select")?.[0])).toContain("patients ( first_name, last_name )");
    // Privacy by default: without the option the patients embed is not requested.
    expect(String(defaultQuery.args("select")?.[0])).not.toContain("patients");
    expect(String(defaultQuery.args("select")?.[0])).toContain("services ( name )");
  });

  it("builds admin movements from amount and service only, never a patient name", async () => {
    // Even if a row carried a patient (it cannot under RLS), it is not shown.
    supabaseMock.onFrom("payments", { data: payments });
    supabaseMock.onFrom("inventory_movements", { data: purchases });

    const summary = await getFinanceSummary("2026-09-01", "2026-10-01");

    const concepts = summary.movements.map((m) => m.concept);
    expect(concepts).toContain("Toxina");
    expect(concepts).toContain("Valoración");
    expect(concepts).toContain("Servicio eliminado");
    for (const name of ["Ana", "Pérez", "Luis", "Gómez", "Eva", "Ruiz"]) {
      expect(concepts.join(" ")).not.toContain(name);
    }
    // Amounts and totals are unchanged.
    expect(summary.income).toBe(1300);
    expect(summary.movements.find((m) => m.id === "p1")?.amount).toBe(800);
  });

  it("degrades to the service alone when the patients embed comes back null", async () => {
    supabaseMock.onFrom("payments", {
      data: [
        {
          id: "p9", status: "paid", amount_charged: "5500.00", list_price: "5500.00",
          created_at: "2026-09-10T16:00:00+00:00",
          services: { name: "Hilos Tensores" }, patients: null,
        },
      ],
    });

    const { movements } = await getFinanceSummary("2026-09-01", "2026-10-01", {
      includePatientNames: true,
    });

    expect(movements[0].concept).toBe("Hilos Tensores");
    expect(movements[0].amount).toBe(5500);
  });

  it("fails with a readable message when a query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("payments", { error: { message: "boom" } });

    await expect(getFinanceSummary("2026-09-01", "2026-10-01")).rejects.toThrow(
      "No se pudieron cargar las finanzas.",
    );
  });
});
