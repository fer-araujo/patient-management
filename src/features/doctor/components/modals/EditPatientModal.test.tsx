import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { supabaseMock, type RecordedQuery } from "../../../../test/supabaseMock";
import type { PatientDetails } from "../../../../lib/services/patientService";
import { EditPatientModal } from "./EditPatientModal";

const patient: PatientDetails = {
  id: "p1",
  first_name: "María",
  last_name: "González",
  phone: "+525512345678",
  email: "maria@ejemplo.com",
  gender: "Femenino",
  dob: "1960-04-12",
  blood_type: "O-",
  allergies: null,
  chronic_conditions: "Diabetes",
  anonymized_at: null,
};

const stubPatient = (details: PatientDetails = patient) =>
  supabaseMock.onFrom("patients", (q: RecordedQuery) =>
    q.has("update") ? { data: [{ id: details.id }] } : { data: details },
  );

const updates = () => supabaseMock.queries("patients").filter((q) => q.has("update"));

const renderModal = async (details?: PatientDetails) => {
  stubPatient(details);
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<EditPatientModal isOpen patientId="p1" onClose={onClose} onSaved={onSaved} />);
  await waitFor(() =>
    expect(screen.queryByText("Cargando datos...")).not.toBeInTheDocument(),
  );
  return { onClose, onSaved, user: userEvent.setup() };
};

const PHONE_NOTE = "El paciente entrará a su portal con el nuevo número.";

describe("EditPatientModal", () => {
  it("pre-fills the form with the saved data", async () => {
    await renderModal();

    expect(screen.getByLabelText("Nombre(s)")).toHaveValue("María");
    expect(screen.getByLabelText("Apellidos")).toHaveValue("González");
    expect(screen.getByLabelText("Número celular")).toHaveValue("5512345678");
    expect(screen.getByText("MX +52")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo")).toHaveValue("maria@ejemplo.com");
    // The app's DatePicker trigger shows the saved date in words, on its own
    // local day (not shifted by UTC).
    expect(screen.getByLabelText("Fecha de nacimiento")).toHaveTextContent(
      "12 de abril de 1960",
    );
    expect(screen.getByText("Femenino")).toBeInTheDocument();
    expect(screen.getByText("O−")).toBeInTheDocument();
    expect(screen.getByLabelText("Enfermedades crónicas")).toHaveValue("Diabetes");
    expect(screen.queryByText(PHONE_NOTE)).not.toBeInTheDocument();
  });

  it("does not save without a first name or a 10-digit phone", async () => {
    const toastError = vi.spyOn(toast, "error");
    const { user, onSaved } = await renderModal();

    await user.clear(screen.getByLabelText("Número celular"));
    await user.type(screen.getByLabelText("Número celular"), "55123");
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));
    expect(toastError).toHaveBeenCalledWith(
      "Ingresa un número a 10 dígitos (te faltan 5).",
    );

    await user.type(screen.getByLabelText("Número celular"), "12345");
    await user.clear(screen.getByLabelText("Nombre(s)"));
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    expect(updates()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("warns that the portal login changes when the phone changes", async () => {
    const { user } = await renderModal();

    await user.clear(screen.getByLabelText("Número celular"));
    await user.type(screen.getByLabelText("Número celular"), "8187654321");
    expect(screen.getByText(PHONE_NOTE)).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Número celular"));
    await user.type(screen.getByLabelText("Número celular"), "5512345678");
    expect(screen.queryByText(PHONE_NOTE)).not.toBeInTheDocument();
  });

  it("saves the corrected data and notifies the parent", async () => {
    const toastSuccess = vi.spyOn(toast, "success");
    const { user, onSaved, onClose } = await renderModal();

    await user.clear(screen.getByLabelText("Correo"));
    await user.type(screen.getByLabelText("Correo"), "maria.g@ejemplo.com");
    await user.clear(screen.getByLabelText("Número celular"));
    await user.type(screen.getByLabelText("Número celular"), "8187654321");
    await user.click(screen.getByText("O−"));
    await user.click(await screen.findByText("No sé"));
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Datos del paciente actualizados");
    expect(updates()).toHaveLength(1);
    expect(updates()[0].args("update")?.[0]).toEqual({
      first_name: "María",
      last_name: "González",
      phone: "+528187654321",
      email: "maria.g@ejemplo.com",
      gender: "Femenino",
      dob: "1960-04-12",
      blood_type: null,
      allergies: null,
      chronic_conditions: "Diabetes",
    });
  });

  it("shows an anonymized record read-only", async () => {
    await renderModal({ ...patient, first_name: null, anonymized_at: "2026-01-01T00:00:00Z" });

    expect(screen.getByText(/fue anonimizado/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre(s)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Guardar Cambios/ })).not.toBeInTheDocument();
  });
});
