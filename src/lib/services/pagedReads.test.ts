import { describe, expect, it } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import { fetchPublicAvailability } from "./availabilityService";
import { fetchBlockedSlots } from "./blockedSlotsService";
import { fetchDoctorAppointments } from "./clinicService";
import { getFinanceSummary } from "./financeService";
import { fetchInventory } from "./inventoryService";
import { fetchPatients } from "./patientService";
import { fetchArcoRequests } from "./privacyService";

/**
 * Every read that uses fetchAllRows must page: a full first page (1,000 rows,
 * PostgREST's max_rows), a short second one, then an empty one that ends the
 * read. Nothing may be cut at the first 1,000 rows.
 */
const EXPECTED_RANGES = [
  [0, 999],
  [1000, 1999],
  [1002, 2001],
];

const pagesOf = <T>(make: (i: number) => T) => [
  { data: Array.from({ length: 1000 }, (_, i) => make(i)) },
  { data: [make(1000), make(1001)] },
  { data: [] },
];

const ranges = (table: string) => supabaseMock.queries(table).map((q) => q.args("range"));

describe("paged reads (fetchAllRows call sites)", () => {
  it("fetchPublicAvailability reads every busy window", async () => {
    const pages = pagesOf(() => ({
      start_time: "2026-10-16T15:00:00.000Z",
      end_time: "2026-10-16T15:30:00.000Z",
    }));
    let call = 0;
    supabaseMock.onRpc("get_availability", () => pages[call++]);

    const busy = await fetchPublicAvailability(new Date("2026-10-01"), new Date("2026-12-01"));

    // Identical windows carry no id: none is dropped as a duplicate.
    expect(busy).toHaveLength(1002);
    expect(ranges("rpc:get_availability")).toEqual(EXPECTED_RANGES);
  });

  it("fetchBlockedSlots reads every block", async () => {
    supabaseMock.onFrom(
      "blocked_slots",
      ...pagesOf((i) => ({
        id: `b${i}`,
        start_time: "2026-10-16T15:00:00.000Z",
        end_time: "2026-10-16T16:00:00.000Z",
        reason: "junta",
      })),
    );

    await expect(fetchBlockedSlots()).resolves.toHaveLength(1002);
    expect(ranges("blocked_slots")).toEqual(EXPECTED_RANGES);
  });

  it("fetchDoctorAppointments reads every appointment", async () => {
    supabaseMock.onFrom(
      "appointments",
      ...pagesOf((i) => ({
        id: `a${i}`,
        start_time: "2026-10-16T15:00:00.000Z",
        status: "confirmed",
        patient_id: "p1",
        service_id: "s1",
        reason: null,
        patients: { first_name: "Ana", last_name: "Pérez", phone: null, status: "active" },
        services: { name: "Consulta", duration_mins: 30, price: 500 },
      })),
    );

    await expect(fetchDoctorAppointments()).resolves.toHaveLength(1002);
    expect(ranges("appointments")).toEqual(EXPECTED_RANGES);
  });

  it("fetchPatients reads every patient", async () => {
    supabaseMock.onFrom(
      "patients",
      ...pagesOf((i) => ({
        id: `p${i}`,
        first_name: "Ana",
        last_name: `Paciente ${i}`,
        phone: null,
        email: null,
        dob: null,
        gender: null,
        blood_type: null,
        allergies: null,
        chronic_conditions: null,
        notes: null,
        status: "active",
        anonymized_at: null,
        weight_tracking: false,
        appointments: [],
        consents: [],
      })),
    );

    await expect(fetchPatients()).resolves.toHaveLength(1002);
    expect(ranges("patients")).toEqual(EXPECTED_RANGES);
  });

  it("fetchInventory reads every item", async () => {
    supabaseMock.onFrom("inventory", ...pagesOf((i) => ({ id: `i${i}`, name: `Insumo ${i}` })));

    await expect(fetchInventory()).resolves.toHaveLength(1002);
    expect(ranges("inventory")).toEqual(EXPECTED_RANGES);
  });

  it("fetchArcoRequests reads every request", async () => {
    supabaseMock.onFrom(
      "arco_requests",
      ...pagesOf((i) => ({
        id: `r${i}`,
        patient_id: "p1",
        request_type: "access",
        details: "Copia de mis datos",
        status: "received",
        created_at: "2026-09-20T16:00:00Z",
        resolved_at: null,
        resolution_note: null,
        channel: null,
      })),
    );

    await expect(fetchArcoRequests()).resolves.toHaveLength(1002);
    expect(ranges("arco_requests")).toEqual(EXPECTED_RANGES);
  });

  it("getFinanceSummary reads every payment and every purchase", async () => {
    supabaseMock.onFrom(
      "payments",
      ...pagesOf((i) => ({
        id: `pay${i}`,
        status: "paid",
        amount_charged: "1.00",
        list_price: "1.00",
        created_at: "2026-09-10T16:00:00+00:00",
        services: { name: "Consulta" },
      })),
    );
    supabaseMock.onFrom(
      "inventory_movements",
      ...pagesOf((i) => ({
        id: `m${i}`,
        quantity: 1,
        total_cost: "1.00",
        created_at: "2026-09-11T16:00:00+00:00",
        inventory: { name: "Gasas" },
      })),
    );

    const summary = await getFinanceSummary("2026-09-01", "2026-10-01");

    expect(summary.income).toBe(1002);
    expect(summary.expenses).toBe(1002);
    expect(ranges("payments")).toEqual(EXPECTED_RANGES);
    expect(ranges("inventory_movements")).toEqual(EXPECTED_RANGES);
  });
});
