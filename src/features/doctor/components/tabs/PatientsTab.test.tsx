import { describe, expect, it } from "vitest";
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
