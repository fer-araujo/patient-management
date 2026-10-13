import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import { NewPatientModal } from "./NewPatientModal";

const renderModal = () => {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<NewPatientModal isOpen={true} onClose={onClose} onCreated={onCreated} />);
  return { user: userEvent.setup(), onClose, onCreated };
};

const fillName = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByPlaceholderText("Ej. María"), "Rosa");
  await user.type(screen.getByPlaceholderText("Ej. González"), "Treviño");
};

const insertedRow = () =>
  (supabaseMock.queries("patients")[0].args("insert")?.[0] as Record<string, unknown>[])[0];

const toggle = () =>
  screen.getByRole("button", { name: "Agregar antecedentes (opcional)" });

describe("NewPatientModal antecedentes", () => {
  it("keeps the section collapsed by default and creates the patient without background", async () => {
    supabaseMock.onFrom("patients", { data: { id: "p-new" } });
    const { user, onCreated } = renderModal();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Alergias")).toBeNull();

    await fillName(user);
    await user.click(screen.getByRole("button", { name: "Crear Expediente" }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ id: "p-new", name: "Rosa Treviño" }),
    );
    expect(insertedRow()).toMatchObject({
      blood_type: null,
      allergies: null,
      chronic_conditions: null,
      family_history: null,
      current_illness: null,
    });
  });

  it("saves the background typed in the optional section with the new patient", async () => {
    supabaseMock.onFrom("patients", { data: { id: "p-new" } });
    const { user, onCreated } = renderModal();

    await fillName(user);
    await user.click(toggle());
    expect(
      screen.getByRole("button", { name: "Ocultar antecedentes" }),
    ).toHaveAttribute("aria-expanded", "true");

    for (const label of [
      "Heredofamiliares",
      "Personales patológicos",
      "Personales no patológicos",
      "Padecimiento actual",
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("placeholder", "Ej. Negados");
    }

    await user.click(screen.getByRole("combobox", { name: "Tipo de sangre" }));
    await user.click(
      within(screen.getByRole("listbox", { name: "Tipo de sangre" })).getByRole(
        "option",
        { name: "AB−" },
      ),
    );
    await user.type(screen.getByLabelText("Alergias"), " Penicilina ");
    await user.type(screen.getByLabelText("Enfermedades crónicas"), "Diabetes");
    await user.type(screen.getByLabelText("Heredofamiliares"), "Madre con diabetes");
    await user.type(screen.getByLabelText("Padecimiento actual"), "Negados");
    await user.click(screen.getByRole("button", { name: "Crear Expediente" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(insertedRow()).toMatchObject({
      first_name: "Rosa",
      last_name: "Treviño",
      blood_type: "AB-",
      allergies: "Penicilina",
      chronic_conditions: "Diabetes",
      family_history: "Madre con diabetes",
      personal_pathological_history: null,
      non_pathological_history: null,
      current_illness: "Negados",
      status: "active",
    });
  });

  it("Cancelar clears the background and collapses the section again", async () => {
    const { user, onClose } = renderModal();

    await user.click(toggle());
    await user.type(screen.getByLabelText("Alergias"), "Látex");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalled();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle());
    expect(screen.getByLabelText("Alergias")).toHaveValue("");
  });
});
