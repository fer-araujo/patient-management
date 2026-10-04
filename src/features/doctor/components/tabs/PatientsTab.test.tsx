import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock, type RecordedQuery } from "../../../../test/supabaseMock";
import { PatientsTab } from "./PatientsTab";

const listRow = {
  id: "p1",
  first_name: "María",
  last_name: "González",
  phone: "+525512345678",
  email: null,
  dob: null,
  gender: null,
  blood_type: null,
  allergies: null,
  chronic_conditions: null,
  notes: null,
  status: "active",
  appointments: [],
};

const details = {
  id: "p1",
  first_name: "María",
  last_name: "González",
  phone: "+525512345678",
  email: null,
  gender: null,
  dob: null,
  blood_type: null,
  allergies: null,
  chronic_conditions: null,
  address: null,
  family_history: null,
  personal_pathological_history: null,
  non_pathological_history: null,
  current_illness: null,
  anonymized_at: null,
};

// The list, the modal's detail read and the update all hit "patients".
const respond = (q: RecordedQuery) => {
  if (q.has("update")) return { data: [{ id: "p1" }] };
  if (q.has("maybeSingle")) return { data: details };
  return { data: [listRow] };
};

const listLoads = () =>
  supabaseMock.queries("patients").filter((q) => q.has("order")).length;

describe("PatientsTab edit personal data", () => {
  it("opens the edit modal from the row and refreshes the list after saving", async () => {
    supabaseMock.onFrom("patients", respond);
    render(<PatientsTab />);
    const user = userEvent.setup();

    const row = (await screen.findByText("María González")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Editar datos" }));

    expect(await screen.findByText("Editar datos del paciente")).toBeInTheDocument();
    expect(await screen.findByLabelText("Nombre(s)")).toHaveValue("María");
    expect(listLoads()).toBe(1);

    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(listLoads()).toBe(2));
    await waitFor(() =>
      expect(screen.queryByText("Editar datos del paciente")).not.toBeInTheDocument(),
    );
  });
});

describe("PatientsTab archived patients", () => {
  it("offers Restaurar Paciente for an archived record but never for an anonymized one", async () => {
    supabaseMock.onFrom("patients", {
      data: [
        { ...listRow, id: "p-arch", first_name: "Rosa", last_name: "Archivada", status: "archived", anonymized_at: null },
        {
          ...listRow,
          id: "p-anon",
          first_name: "Paciente",
          last_name: "Anonimizado",
          phone: null,
          status: "archived",
          anonymized_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    render(<PatientsTab />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Archivados" }));

    const archivedRow = (await screen.findByText("Rosa Archivada")).closest("tr")!;
    const anonymizedRow = screen.getByText("Paciente Anonimizado").closest("tr")!;
    expect(
      within(archivedRow).getByRole("button", { name: "Restaurar Paciente" }),
    ).toBeInTheDocument();
    expect(
      within(anonymizedRow).queryByRole("button", { name: "Restaurar Paciente" }),
    ).not.toBeInTheDocument();
  });
});

describe("PatientsTab new patient form", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the app's DatePicker and Dropdown, never native date or select inputs", async () => {
    supabaseMock.onFrom("patients", respond);
    render(<PatientsTab />);
    const user = userEvent.setup();
    await screen.findByText("María González");

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));
    const form = (await screen.findByRole("button", { name: "Crear Expediente" })).closest(
      "form",
    )!;

    expect(form.querySelector('input[type="date"]')).toBeNull();
    expect(form.querySelector("select")).toBeNull();
    // Every button except "Crear Expediente" is a plain button.
    for (const button of within(form).getAllByRole("button")) {
      if (button.textContent !== "Crear Expediente") {
        expect(button).toHaveAttribute("type", "button");
      }
    }
    expect(screen.getByLabelText("Fecha de nacimiento")).toHaveTextContent("Seleccionar...");
    expect(screen.getByRole("combobox", { name: "Género" })).toHaveTextContent(
      "Sin especificar",
    );
  });

  it("creates the patient with the birth date picked (past years) and the gender chosen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 27, 12, 0));
    supabaseMock.onFrom("patients", respond);
    render(<PatientsTab />);
    const user = userEvent.setup();
    await screen.findByText("María González");

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));
    await user.type(await screen.findByPlaceholderText("Ej. María"), "Rosa");
    await user.type(screen.getByPlaceholderText("Ej. González"), "Treviño");

    // Birth date: calendar header -> year -> month -> day -> OK.
    await user.click(screen.getByLabelText("Fecha de nacimiento"));
    await user.click(await screen.findByText("Septiembre 2026"));
    await user.click(screen.getByRole("button", { name: "2025" }));
    await user.click(screen.getByRole("button", { name: "Mar" }));
    await user.click(screen.getByRole("button", { name: "12" }));
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.getByLabelText("Fecha de nacimiento")).toHaveTextContent(
      "12 de marzo de 2025",
    );

    await user.click(screen.getByRole("combobox", { name: "Género" }));
    await user.click(await screen.findByRole("option", { name: "Femenino" }));

    await user.click(screen.getByRole("button", { name: "Crear Expediente" }));

    await waitFor(() =>
      expect(supabaseMock.queries("patients").some((q) => q.has("insert"))).toBe(true),
    );
    const insert = supabaseMock.queries("patients").find((q) => q.has("insert"))!;
    expect(insert.args("insert")?.[0]).toEqual([
      expect.objectContaining({
        first_name: "Rosa",
        last_name: "Treviño",
        dob: "2025-03-12",
        gender: "Femenino",
      }),
    ]);
  });
});
