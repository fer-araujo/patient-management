import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { supabaseMock, type RecordedQuery } from "../../../../test/supabaseMock";
import type { PatientDetails } from "../../../../lib/services/patientService";
import { EditPatientModal } from "./EditPatientModal";
import { PRIVACY_NOTICE_VERSION } from "../../../../lib/legal/privacyNotice";

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
  address: "Av. Juárez 10, Centro, Monterrey",
  family_history: "Madre con diabetes",
  personal_pathological_history: null,
  non_pathological_history: null,
  current_illness: null,
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
      address: "Av. Juárez 10, Centro, Monterrey",
      family_history: "Madre con diabetes",
      personal_pathological_history: null,
      non_pathological_history: null,
      current_illness: null,
    });
  });

  it("edits the address and the clinical history (antecedentes)", async () => {
    const { user, onSaved } = await renderModal();

    expect(screen.getByLabelText("Domicilio")).toHaveValue(
      "Av. Juárez 10, Centro, Monterrey",
    );
    expect(screen.getByText("Antecedentes")).toBeInTheDocument();
    expect(screen.getByLabelText("Heredofamiliares")).toHaveValue("Madre con diabetes");
    expect(screen.getByLabelText("Personales patológicos")).toHaveValue("");

    await user.clear(screen.getByLabelText("Domicilio"));
    await user.type(screen.getByLabelText("Domicilio"), "Calle 5 #20, Mitras, Monterrey");
    await user.clear(screen.getByLabelText("Heredofamiliares"));
    await user.type(screen.getByLabelText("Personales patológicos"), "Cirugía de vesícula 2010");
    await user.type(screen.getByLabelText("Personales no patológicos"), "No fuma");
    await user.type(screen.getByLabelText("Padecimiento actual"), "Manchas en mejillas");
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updates()[0].args("update")?.[0]).toMatchObject({
      address: "Calle 5 #20, Mitras, Monterrey",
      // Cleared fields are stored as empty (null), not as "".
      family_history: null,
      personal_pathological_history: "Cirugía de vesícula 2010",
      non_pathological_history: "No fuma",
      current_illness: "Manchas en mejillas",
    });
  });

  it('suggests "Ej. Negados" in every clinical-history field, which stays optional', async () => {
    const { user, onSaved } = await renderModal();

    for (const label of [
      "Heredofamiliares",
      "Personales patológicos",
      "Personales no patológicos",
      "Padecimiento actual",
    ]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("placeholder", "Ej. Negados");
      expect(field).not.toBeRequired();
    }

    // Filled history is still editable, and emptying it does not block saving.
    await user.clear(screen.getByLabelText("Heredofamiliares"));
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("shows an anonymized record read-only", async () => {
    await renderModal({ ...patient, first_name: null, anonymized_at: "2026-01-01T00:00:00Z" });

    expect(screen.getByText(/fue anonimizado/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre(s)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Guardar Cambios/ })).not.toBeInTheDocument();
  });
});

describe("EditPatientModal privacy notice signed on paper", () => {
  const PAPER = "El paciente firmó el aviso de privacidad en papel";

  it("records the paper consent after saving when the box is ticked", async () => {
    supabaseMock.onFrom("consents", { data: [] });
    supabaseMock.onRpc("record_consent_in_person", { data: true });
    const { onClose, user } = await renderModal();

    const box = await screen.findByRole("checkbox", { name: PAPER });
    await user.click(box);
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(updates()).toHaveLength(1);
    expect(supabaseMock.rpcCalls("record_consent_in_person")).toEqual([
      { name: "record_consent_in_person", args: { p_patient_id: "p1" } },
    ]);
    // The lookup asked for the CURRENT notice of this patient.
    const lookup = supabaseMock.queries("consents")[0];
    expect(lookup.allArgs("eq")).toEqual([
      ["patient_id", "p1"],
      ["document", "aviso_privacidad"],
      ["version", PRIVACY_NOTICE_VERSION],
    ]);
  });

  it("does not record anything when the box is left empty", async () => {
    supabaseMock.onFrom("consents", { data: [] });
    const { onClose, user } = await renderModal();

    await screen.findByRole("checkbox", { name: PAPER });
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(supabaseMock.rpcCalls("record_consent_in_person")).toHaveLength(0);
  });

  it("says the notice is already signed instead of offering the box", async () => {
    supabaseMock.onFrom("consents", { data: [{ id: "c1" }] });
    await renderModal();

    expect(await screen.findByText("Aviso de privacidad firmado.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: PAPER })).not.toBeInTheDocument();
  });

  it("refreshes the list only after the consent step", async () => {
    supabaseMock.onFrom("consents", { data: [] });
    supabaseMock.onRpc("record_consent_in_person", { data: true });
    const { onSaved, user } = await renderModal();
    let consentCallsWhenSaved = -1;
    onSaved.mockImplementation(() => {
      consentCallsWhenSaved = supabaseMock.rpcCalls("record_consent_in_person").length;
    });

    await user.click(await screen.findByRole("checkbox", { name: PAPER }));
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(consentCallsWhenSaved).toBe(1);
  });

  it("keeps the form open with the reason when the consent cannot be recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    supabaseMock.onFrom("consents", { data: [] });
    supabaseMock.onRpc("record_consent_in_person", {
      error: { message: "Este expediente fue anonimizado. No se puede registrar un consentimiento.", code: "P0001" },
    });
    const { onClose, onSaved, user } = await renderModal();

    await user.click(await screen.findByRole("checkbox", { name: PAPER }));
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Este expediente fue anonimizado. No se puede registrar un consentimiento.",
      ),
    );
    // The personal data was saved; only the consent failed.
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("EditPatientModal weight tracking", () => {
  const WEIGHT = "Llevar control de peso";
  const trackingWrites = () =>
    updates().filter((q) => "weight_tracking" in ((q.args("update")?.[0] as object) ?? {}));

  it("shows the saved flag and turns it on with the save, then refreshes the list", async () => {
    const { onSaved, onClose, user } = await renderModal();

    const box = await screen.findByRole("checkbox", { name: WEIGHT });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(trackingWrites()).toHaveLength(1);
    expect(trackingWrites()[0].args("update")).toEqual([{ weight_tracking: true }]);
    // Never on an anonymized record.
    expect(trackingWrites()[0].allArgs("is")).toEqual([["anonymized_at", null]]);
  });

  it("does not write the flag when it did not change", async () => {
    const { onClose, user } = await renderModal();

    await screen.findByRole("checkbox", { name: WEIGHT });
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(trackingWrites()).toHaveLength(0);
  });

  it("says the measurements are kept when turning it off", async () => {
    const { user } = await renderModal({
      ...patient,
      weight_tracking: true,
    } as PatientDetails);

    const box = await screen.findByRole("checkbox", { name: WEIGHT });
    expect(box).toBeChecked();
    await user.click(box);

    expect(screen.getByText("Las mediciones guardadas no se borran.")).toBeInTheDocument();
  });

  it("keeps the form open when the flag cannot be changed, still refreshing the list once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    const { onSaved, onClose, user } = await renderModal();
    supabaseMock.onFrom("patients", (q: RecordedQuery) => {
      if (q.has("update")) {
        const values = q.args("update")?.[0] as Record<string, unknown>;
        return "weight_tracking" in values
          ? { error: { message: "boom", code: "500" } }
          : { data: [{ id: "p1" }] };
      }
      return { data: patient };
    });

    await user.click(await screen.findByRole("checkbox", { name: WEIGHT }));
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "No se pudo cambiar el control de peso. Intenta de nuevo.",
      ),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not offer the box when the flag cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("patients", (q: RecordedQuery) =>
      q.args("select")?.[0] === "weight_tracking"
        ? { error: { message: "boom", code: "500" } }
        : { data: patient },
    );
    render(<EditPatientModal isOpen patientId="p1" onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByLabelText("Nombre(s)")).toHaveValue("María");
    expect(screen.queryByRole("checkbox", { name: WEIGHT })).not.toBeInTheDocument();
  });
});
