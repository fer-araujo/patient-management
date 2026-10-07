import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

  it("keeps the deadline explanation as a desktop tooltip; touch and phones get it as text", async () => {
    const user = await renderInbox();
    await user.click(screen.getByRole("tab", { name: "Pendientes (2)" }));

    const hints = screen.getAllByTestId("arco-deadline-hint");
    expect(hints).toHaveLength(2);
    for (const hint of hints) {
      // jsdom applies no Tailwind CSS, so check the classes: hidden with a
      // mouse at desktop widths, shown only under the touch/phone variants.
      const classes = hint.className.split(/\s+/);
      expect(classes).toContain("hidden");
      expect(classes).not.toContain("block");
      expect(classes).toEqual(
        expect.arrayContaining(["pointer-coarse:block", "max-md:block"]),
      );
      expect(hint.parentElement).toHaveAttribute(
        "title",
        expect.stringContaining("días hábiles para responder"),
      );
    }
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

describe("ArcoRequestsTab correcting data from the request detail", () => {
  it("keeps the detail and the edit form open when a save step fails, and still reloads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("arco_requests", {
      data: [request("r1", "p-rect", "rectification", "Ana")],
    });
    supabaseMock.onFrom("patients", (q) =>
      q.has("update")
        ? { data: [{ id: "p-rect" }] }
        : {
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
          },
    );
    supabaseMock.onFrom("consents", { data: [] });
    supabaseMock.onRpc("record_consent_in_person", {
      error: { message: "No se pudo registrar el aviso.", code: "P0001" },
    });
    render(<ArcoRequestsTab />);
    await screen.findByText("Ana Pérez");
    const user = userEvent.setup();

    // Todas (table) -> detail modal -> nested edit form.
    await user.click(screen.getByRole("button", { name: "Ver solicitud de Ana Pérez" }));
    expect(await screen.findByRole("heading", { name: "Solicitud" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver y corregir datos" }));
    expect(await screen.findByLabelText("Nombre(s)")).toHaveValue("Ana");

    await user.click(
      await screen.findByRole("checkbox", {
        name: "El paciente firmó el aviso de privacidad en papel",
      }),
    );
    const readsBeforeSave = supabaseMock.queries("arco_requests").length;
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    // The data was saved, so the list reloads...
    await waitFor(() =>
      expect(supabaseMock.queries("arco_requests").length).toBeGreaterThan(readsBeforeSave),
    );
    // ...but the failed consent step keeps both the detail and the form open.
    expect(screen.getByRole("heading", { name: "Solicitud" })).toBeInTheDocument();
    expect(screen.getByText("Editar datos del paciente")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre(s)")).toHaveValue("Ana");
  });
});

describe("ArcoRequestsTab offline requests (Registrar solicitud)", () => {
  const listRow = (id: string, first: string, last: string, extra: Record<string, unknown> = {}) => ({
    id,
    first_name: first,
    last_name: last,
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
    appointments: [],
    consents: [],
    ...extra,
  });

  const renderRegister = async () => {
    let registered = false;
    supabaseMock.onFrom("arco_requests", () => ({
      data: registered
        ? [
            request("r-phone", "p-luz", "rectification", "Luz", {
              channel: "telefono",
              created_at: "2026-10-04T17:00:00Z",
            }),
          ]
        : [],
    }));
    supabaseMock.onFrom("patients", {
      data: [
        listRow("p-luz", "Luz", "Garza"),
        listRow("p-mar", "Mario", "Treviño"),
        listRow("p-anon", "Paciente", "Anonimizado", { anonymized_at: "2026-01-01T00:00:00Z" }),
      ],
    });
    supabaseMock.onRpc("staff_register_arco_request", () => {
      registered = true;
      return { data: "r-phone" };
    });
    render(<ArcoRequestsTab />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Registrar solicitud/ }));
    await screen.findByText("Buscar paciente...");
    return user;
  };

  it("records a request received by phone and lists it with its channel", async () => {
    const user = await renderRegister();

    await user.click(screen.getByRole("combobox", { name: /Paciente/ }));
    await user.type(screen.getByPlaceholderText("Buscar..."), "luz");
    await user.click(await screen.findByRole("option", { name: "Luz Garza" }));
    await user.click(screen.getByRole("combobox", { name: /Tipo de solicitud/ }));
    await user.click(await screen.findByRole("option", { name: "Corregir mis datos" }));
    await user.click(screen.getByRole("combobox", { name: /Cómo llegó/ }));
    await user.click(await screen.findByRole("option", { name: "Por teléfono" }));
    await user.type(screen.getByLabelText(/Qué pidió/), "  Corregir su correo.  ");
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    await waitFor(() =>
      expect(supabaseMock.lastRpc("staff_register_arco_request")?.args).toEqual({
        p_patient_id: "p-luz",
        p_request_type: "rectification",
        p_details: "Corregir su correo.",
        p_channel: "telefono",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Registrar" })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("Luz Pérez")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Pendientes/ }));
    expect(within(cardOf("Luz Pérez")).getByText(/Por teléfono/)).toBeInTheDocument();
  });

  it("never offers an anonymized record", async () => {
    const user = await renderRegister();

    await user.click(screen.getByRole("combobox", { name: /Paciente/ }));

    expect(await screen.findByRole("option", { name: "Luz Garza" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Paciente Anonimizado" })).toBeNull();
  });

  it("asks for every field before calling the server", async () => {
    const user = await renderRegister();

    await user.click(screen.getByRole("button", { name: "Registrar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Elige el paciente que hizo la solicitud.");
    expect(supabaseMock.rpcCalls("staff_register_arco_request")).toHaveLength(0);
  });

  it("keeps the form open with the server's reason when it refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await renderRegister();
    supabaseMock.onRpc("staff_register_arco_request", {
      error: { message: "Este expediente fue anonimizado. No se puede registrar una solicitud.", code: "P0001" },
    });

    await user.click(screen.getByRole("combobox", { name: /Paciente/ }));
    await user.click(await screen.findByRole("option", { name: "Mario Treviño" }));
    await user.click(screen.getByRole("combobox", { name: /Tipo de solicitud/ }));
    await user.click(await screen.findByRole("option", { name: "Resumen clínico" }));
    await user.click(screen.getByRole("combobox", { name: /Cómo llegó/ }));
    await user.click(await screen.findByRole("option", { name: "En persona" }));
    await user.type(screen.getByLabelText(/Qué pidió/), "Copia de sus datos.");
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("fue anonimizado");
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
  });
});
