import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeSession, supabaseMock } from "../../../test/supabaseMock";
import { DoctorAdminDashboard } from "./DoctorAdminDashboard";

// Only Finanzas is under test; the other tabs and the chart are placeholders.
vi.mock("./tabs/CatalogTab", () => ({ CatalogTab: () => <p>Catalog</p> }));
vi.mock("./tabs/InventoryTab", () => ({ InventoryTab: () => <p>Inventory</p> }));
vi.mock("./tabs/FinanceChart", () => ({ FinanceChart: () => <div /> }));

const PAYMENTS = [
  {
    id: "p1", status: "paid", amount_charged: "5500.00", list_price: "5500.00",
    created_at: "2026-09-10T16:00:00+00:00",
    services: { name: "Hilos Tensores" }, patients: { first_name: "Ana", last_name: "Pérez" },
  },
];

const openFinances = async (role: "doctor" | "admin") => {
  supabaseMock.setSession(makeSession(`${role}-user`));
  supabaseMock.onFrom("profiles", { data: { role } });
  supabaseMock.onFrom("inventory", { data: [] });
  supabaseMock.onFrom("payments", { data: PAYMENTS });
  supabaseMock.onFrom("inventory_movements", { data: [] });

  render(<DoctorAdminDashboard />);
  await userEvent.setup().click(screen.getByText("Finanzas y Métricas"));
  await screen.findByText("Movimientos recientes");
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-25T12:00:00-06:00"));
});

describe("DoctorAdminDashboard Finanzas privacy", () => {
  it("an admin sees the charge and the service, not the patient", async () => {
    await openFinances("admin");

    expect(await screen.findByText("Hilos Tensores")).toBeInTheDocument();
    expect(screen.queryByText(/Ana|Pérez/)).not.toBeInTheDocument();
    for (const query of supabaseMock.queries("payments")) {
      expect(String(query.args("select")?.[0])).not.toContain("patients");
    }
  });

  it("the doctor still sees who each charge was for", async () => {
    await openFinances("doctor");

    expect(await screen.findByText("Hilos Tensores · Ana Pérez")).toBeInTheDocument();
  });
});
