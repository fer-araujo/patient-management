import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "react-hot-toast/headless";
import { supabaseMock, type RecordedQuery } from "../../../../test/supabaseMock";
import { PatientsTab } from "./PatientsTab";
import { PRIVACY_NOTICE_VERSION } from "../../../../lib/legal/privacyNotice";

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

// One load reads pages until an empty one: count the first pages.
const listLoads = () =>
  supabaseMock.queries("patients").filter((q) => q.has("order") && q.args("range")?.[0] === 0)
    .length;

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

describe("PatientsTab privacy notice signed on paper", () => {
  it("shows in the directory, with a text label, who signed the current notice and who did not", async () => {
    supabaseMock.onFrom("patients", {
      data: [
        {
          ...listRow,
          id: "p-signed",
          first_name: "Ana",
          last_name: "Firmada",
          consents: [{ document: "aviso_privacidad", version: PRIVACY_NOTICE_VERSION }],
        },
        {
          ...listRow,
          id: "p-old",
          first_name: "Beto",
          last_name: "Anterior",
          // Consent to an older notice does not count.
          consents: [{ document: "aviso_privacidad", version: "2020-01-01" }],
        },
        { ...listRow, id: "p-none", first_name: "Carla", last_name: "Nueva", consents: [] },
      ],
    });
    render(<PatientsTab />);

    const signed = (await screen.findByText("Ana Firmada")).closest("tr")!;
    expect(within(signed).getByText("Aviso firmado")).toBeInTheDocument();
    expect(
      within(screen.getByText("Beto Anterior").closest("tr")!).getByText("Sin aviso firmado"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Carla Nueva").closest("tr")!).getByText("Sin aviso firmado"),
    ).toBeInTheDocument();

    // fetchPatients asks for the consents with the list.
    const list = supabaseMock.queries("patients").find((q) => q.has("order"))!;
    expect(String(list.args("select")?.[0])).toMatch(/consents \( document, version \)/);
  });

  it("records the paper consent for the new patient when the box is ticked", async () => {
    supabaseMock.onFrom("patients", (q: RecordedQuery) =>
      q.has("insert") ? { data: { id: "new-id" } } : { data: [listRow] },
    );
    supabaseMock.onRpc("record_consent_in_person", { data: true });
    render(<PatientsTab />);
    const user = userEvent.setup();
    await screen.findByText("María González");

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));
    await user.type(await screen.findByPlaceholderText("Ej. María"), "Rosa");
    await user.type(screen.getByPlaceholderText("Ej. González"), "Treviño");
    const box = screen.getByRole("checkbox", {
      name: "El paciente firmó el aviso de privacidad en papel",
    });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Crear Expediente" }));

    await waitFor(() =>
      expect(supabaseMock.rpcCalls("record_consent_in_person")).toEqual([
        { name: "record_consent_in_person", args: { p_patient_id: "new-id" } },
      ]),
    );
  });

  it("records nothing when the box is not ticked", async () => {
    supabaseMock.onFrom("patients", (q: RecordedQuery) =>
      q.has("insert") ? { data: { id: "new-id" } } : { data: [listRow] },
    );
    render(<PatientsTab />);
    const user = userEvent.setup();
    await screen.findByText("María González");

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));
    await user.type(await screen.findByPlaceholderText("Ej. María"), "Rosa");
    await user.type(screen.getByPlaceholderText("Ej. González"), "Treviño");
    await user.click(screen.getByRole("button", { name: "Crear Expediente" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Crear Expediente" })).not.toBeInTheDocument(),
    );
    expect(supabaseMock.rpcCalls("record_consent_in_person")).toHaveLength(0);
  });
});

describe("PatientsTab weight tracking in the directory", () => {
  it("marks the patients the doctor follows with an icon and the words, not only a color", async () => {
    supabaseMock.onFrom("patients", {
      data: [
        { ...listRow, id: "p-w", first_name: "Wendy", last_name: "Peso", weight_tracking: true },
        { ...listRow, id: "p-n", first_name: "Nora", last_name: "Normal", weight_tracking: false },
      ],
    });
    render(<PatientsTab />);

    const tracked = (await screen.findByText("Wendy Peso")).closest("tr")!;
    expect(within(tracked).getByText("Control de peso")).toBeInTheDocument();
    const untracked = screen.getByText("Nora Normal").closest("tr")!;
    expect(within(untracked).queryByText("Control de peso")).not.toBeInTheDocument();

    // fetchPatients asks for the flag with the list.
    const list = supabaseMock.queries("patients").find((q) => q.has("order"))!;
    expect(String(list.args("select")?.[0])).toMatch(/\bweight_tracking\b/);
  });
});

describe("PatientsTab new patient form reset", () => {
  it("starts empty and unticked again after Cancelar (an explicit discard)", async () => {
    supabaseMock.onFrom("patients", { data: [listRow] });
    render(<PatientsTab />);
    const user = userEvent.setup();
    await screen.findByText("María González");

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));
    await user.type(await screen.findByPlaceholderText("Ej. María"), "Rosa");
    await user.click(
      screen.getByRole("checkbox", { name: "El paciente firmó el aviso de privacidad en papel" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Crear Expediente" })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));

    expect(await screen.findByPlaceholderText("Ej. María")).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: "El paciente firmó el aviso de privacidad en papel" }),
    ).not.toBeChecked();
  });

  it("keeps the typed fields after an accidental close (X or backdrop), never the tick", async () => {
    supabaseMock.onFrom("patients", { data: [listRow] });
    render(<PatientsTab />);
    const user = userEvent.setup();
    await screen.findByText("María González");

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));
    await user.type(await screen.findByPlaceholderText("Ej. María"), "Rosa");
    await user.click(
      screen.getByRole("checkbox", { name: "El paciente firmó el aviso de privacidad en papel" }),
    );
    // The modal header's close (X) button, same handler as the backdrop.
    const header = screen.getByRole("heading", { name: "Nuevo Paciente" }).parentElement!
      .parentElement!;
    await user.click(within(header).getByRole("button"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Crear Expediente" })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));

    expect(await screen.findByPlaceholderText("Ej. María")).toHaveValue("Rosa");
    expect(
      screen.getByRole("checkbox", { name: "El paciente firmó el aviso de privacidad en papel" }),
    ).not.toBeChecked();
  });

  it("creates the patient even when the paper consent fails, says so, and refreshes the list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    supabaseMock.onFrom("patients", (q: RecordedQuery) =>
      q.has("insert") ? { data: { id: "new-id" } } : { data: [listRow] },
    );
    supabaseMock.onRpc("record_consent_in_person", {
      error: { message: "boom", code: "500" },
    });
    render(<PatientsTab />);
    const user = userEvent.setup();
    await screen.findByText("María González");
    const loadsBefore = listLoads();

    await user.click(screen.getByRole("button", { name: "+ Nuevo Paciente" }));
    await user.type(await screen.findByPlaceholderText("Ej. María"), "Rosa");
    await user.type(screen.getByPlaceholderText("Ej. González"), "Treviño");
    await user.click(
      screen.getByRole("checkbox", { name: "El paciente firmó el aviso de privacidad en papel" }),
    );
    await user.click(screen.getByRole("button", { name: "Crear Expediente" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "El paciente se creó, pero no se registró el aviso de privacidad. Márcalo de nuevo en Editar datos.",
      ),
    );
    expect(supabaseMock.queries("patients").filter((q) => q.has("insert"))).toHaveLength(1);
    await waitFor(() => expect(listLoads()).toBe(loadsBefore + 1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Crear Expediente" })).not.toBeInTheDocument(),
    );
  });
});

describe("PatientsTab edit refreshes the directory badges", () => {
  it("shows Aviso firmado right after a paper consent is recorded in Editar datos", async () => {
    let consentRecorded = false;
    supabaseMock.onFrom("patients", (q: RecordedQuery) => {
      if (q.has("update")) return { data: [{ id: "p1" }] };
      if (q.has("maybeSingle")) return { data: details };
      return {
        data: [
          {
            ...listRow,
            consents: consentRecorded
              ? [{ document: "aviso_privacidad", version: PRIVACY_NOTICE_VERSION }]
              : [],
          },
        ],
      };
    });
    supabaseMock.onFrom("consents", { data: [] });
    supabaseMock.onRpc("record_consent_in_person", () => {
      consentRecorded = true;
      return { data: true };
    });
    render(<PatientsTab />);
    const user = userEvent.setup();

    const row = (await screen.findByText("María González")).closest("tr")!;
    expect(within(row).getByText("Sin aviso firmado")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Editar datos" }));
    await user.click(
      await screen.findByRole("checkbox", {
        name: "El paciente firmó el aviso de privacidad en papel",
      }),
    );
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() =>
      expect(
        within(screen.getByText("María González").closest("tr")!).getByText("Aviso firmado"),
      ).toBeInTheDocument(),
    );
  });
});
