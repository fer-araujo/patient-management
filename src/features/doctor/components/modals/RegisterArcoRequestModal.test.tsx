import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import { RegisterArcoRequestModal } from "./RegisterArcoRequestModal";

const patientRow = {
  id: "p-luz",
  first_name: "Luz",
  last_name: "Garza",
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
};

const renderModal = () => {
  const onClose = vi.fn();
  const onRegistered = vi.fn();
  render(
    <RegisterArcoRequestModal isOpen onClose={onClose} onRegistered={onRegistered} />,
  );
  return { onClose, onRegistered, user: userEvent.setup() };
};

describe("RegisterArcoRequestModal", () => {
  it("says the patient list could not be loaded and only offers Cerrar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("patients", { error: { message: "network down" } });
    const { onClose, user } = renderModal();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cargar la lista de pacientes.",
    );
    expect(screen.queryByRole("button", { name: "Registrar" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks for at least 5 characters (after trimming) of what the patient asked", async () => {
    supabaseMock.onFrom("patients", { data: [patientRow] });
    supabaseMock.onRpc("staff_register_arco_request", { data: "r1" });
    const { onRegistered, user } = renderModal();
    await screen.findByText("Buscar paciente...");

    await user.click(screen.getByRole("combobox", { name: /Paciente/ }));
    await user.click(await screen.findByRole("option", { name: "Luz Garza" }));
    await user.click(screen.getByRole("combobox", { name: /Tipo de solicitud/ }));
    await user.click(await screen.findByRole("option", { name: "Corregir mis datos" }));
    await user.click(screen.getByRole("combobox", { name: /Cómo llegó/ }));
    await user.click(await screen.findByRole("option", { name: "Por teléfono" }));

    // Four characters, padded with spaces: still too short.
    const details = screen.getByLabelText(/Qué pidió/);
    await user.type(details, "  Dato  ");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Describe brevemente lo que pidió el paciente.",
    );
    expect(supabaseMock.rpcCalls("staff_register_arco_request")).toHaveLength(0);

    // Exactly five characters is enough.
    await user.clear(details);
    await user.type(details, "Datos");
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    await vi.waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1));
    expect(supabaseMock.lastRpc("staff_register_arco_request")?.args).toMatchObject({
      p_details: "Datos",
    });
  });
});
