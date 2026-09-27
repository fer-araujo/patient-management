import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import { ArcoRequestsTab } from "./ArcoRequestsTab";

const request = (
  id: string,
  patientId: string,
  requestType: string,
  firstName: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  patient_id: patientId,
  request_type: requestType,
  details: `Detalle ${id}`,
  status: "received",
  created_at: "2026-09-20T15:00:00Z",
  resolved_at: null,
  resolution_note: null,
  patients: { first_name: firstName, last_name: "Pérez" },
  ...extra,
});

const renderTab = async () => {
  supabaseMock.onFrom("arco_requests", {
    data: [
      request("r1", "p-rect", "rectification", "Ana"),
      request("r2", "p-access", "access", "Luis"),
      request("r3", "p-cancel", "cancellation", "Rosa"),
    ],
  });
  supabaseMock.onFrom("patients", {
    data: {
      id: "p-rect",
      first_name: "Ana",
      last_name: "Pérez",
      phone: "+525512345678",
      email: null,
      gender: null,
      dob: null,
      blood_type: null,
      allergies: null,
      chronic_conditions: null,
      anonymized_at: null,
    },
  });
  render(<ArcoRequestsTab />);
  await screen.findByText("Ana Pérez");
  const user = userEvent.setup();
  // The tab opens on "Todas" (table); the actionable cards live in Pendientes.
  await user.click(screen.getByRole("tab", { name: /Pendientes/ }));
  return user;
};

const cardOf = (name: string) => screen.getByText(name).closest("li")!;

describe("ArcoRequestsTab inbox", () => {
  const renderInbox = async () => {
    supabaseMock.onFrom("arco_requests", {
      data: [
        // Newer request, later deadline.
        request("r-new", "p1", "rectification", "Nora", {
          created_at: "2026-09-22T15:00:00Z",
        }),
        // Older request, sooner deadline: must be listed first.
        request("r-old", "p2", "access", "Olga", {
          created_at: "2026-09-01T15:00:00Z",
        }),
        request("r-done", "p3", "opposition", "Dora", {
          status: "resolved",
          resolved_at: "2026-09-10T15:00:00Z",
          resolution_note: "Listo.",
        }),
        request("r-no", "p4", "cancellation", "Noé", { status: "rejected" }),
      ],
    });
    render(<ArcoRequestsTab />);
    await screen.findByText("Nora Pérez");
    return userEvent.setup();
  };

  it("opens on Todas and lists pending requests soonest deadline first", async () => {
    const user = await renderInbox();

    // Default view: every request, as the table.
    expect(screen.getByRole("tab", { name: "Todas (4)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Dora Pérez")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Pendientes (2)" }));
    const names = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(names).toEqual(["Olga Pérez", "Nora Pérez"]);
    expect(screen.queryByText("Dora Pérez")).toBeNull();
  });

  it("shows closed requests as a table whose rows open the full card", async () => {
    const user = await renderInbox();

    await user.click(screen.getByRole("tab", { name: "Atendidas (1)" }));
    expect(screen.getByText("Dora Pérez")).toBeInTheDocument();
    expect(screen.queryByText("Nora Pérez")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Ver solicitud de Dora Pérez" }));
    expect(await screen.findByRole("heading", { name: "Solicitud" })).toBeInTheDocument();
    expect(screen.getByText("Listo.")).toBeInTheDocument();
  });

  it("filters by patient name", async () => {
    const user = await renderInbox();

    await user.click(screen.getByRole("tab", { name: "Pendientes (2)" }));
    await user.type(screen.getByPlaceholderText("Buscar paciente..."), "olg");
    expect(screen.getByText("Olga Pérez")).toBeInTheDocument();
    expect(screen.queryByText("Nora Pérez")).toBeNull();
  });
});

describe("ArcoRequestsTab rectification", () => {
  it("offers to correct the data only on rectification requests", async () => {
    await renderTab();

    expect(
      within(cardOf("Ana Pérez")).getByRole("button", { name: "Ver y corregir datos" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ver y corregir datos" })).toHaveLength(1);
    expect(
      within(cardOf("Luis Pérez")).queryByRole("button", { name: "Ver y corregir datos" }),
    ).not.toBeInTheDocument();
  });

  it("opens the edit modal for that request's patient", async () => {
    const user = await renderTab();

    await user.click(screen.getByRole("button", { name: "Ver y corregir datos" }));

    expect(await screen.findByText("Editar datos del paciente")).toBeInTheDocument();
    expect(await screen.findByLabelText("Nombre(s)")).toHaveValue("Ana");
    expect(supabaseMock.queries("patients")[0].args("eq")).toEqual(["id", "p-rect"]);
  });
});
