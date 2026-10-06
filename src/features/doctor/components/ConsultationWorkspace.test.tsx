import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import type { DashboardAppointment } from "../../../lib/services/clinicService";
import type {
  DashboardPatient,
  PatientDetails,
} from "../../../lib/services/patientService";
import {
  fetchFinalizedPrescription,
  fetchPatientHistory,
  finalizeConsultation,
  finalizeConsultationWithPayment,
  savePrescription,
  saveSoapNote,
  type Prescription,
  type SoapNote,
} from "../../../lib/services/soapService";
import { getPatientFiles } from "../../../lib/services/storageService";
import {
  ANONYMIZED_PATIENT_MESSAGE,
  fetchPatientDetails,
  fetchPatientNotes,
  updatePatientBackground,
  updatePatientNotes,
} from "../../../lib/services/patientService";
import { recordPayment, type Payment } from "../../../lib/services/financeService";
import { supabaseMock } from "../../../test/supabaseMock";
import {
  getWeightTracking,
  listBodyMeasurements,
  setWeightTracking,
} from "../../../lib/services/bodyMeasurementService";
import {
  downloadSignature,
  issuePrescription,
  logPrescriptionShared,
} from "../../../lib/services/prescriberService";
import { TEST_SIGNATURE_PNG } from "../../../test/signaturePng";
import { buildPrescriptionPdf } from "../prescription/buildPrescriptionPdf";
import { ConsultationWorkspace } from "./ConsultationWorkspace";

vi.mock("../../../lib/services/soapService", async (importOriginal) => ({
  // The pure draft finder stays real; only the database calls are mocked.
  findConsultationDraft: (
    await importOriginal<typeof import("../../../lib/services/soapService")>()
  ).findConsultationDraft,
  fetchPatientHistory: vi.fn(),
  fetchFinalizedPrescription: vi.fn(),
  saveSoapNote: vi.fn(),
  savePrescription: vi.fn(),
  finalizeConsultation: vi.fn(),
  finalizeConsultationWithPayment: vi.fn(),
  addNoteAddendum: vi.fn(),
}));
vi.mock("../../../lib/services/storageService", () => ({
  getPatientFiles: vi.fn(),
  uploadPatientFile: vi.fn(),
  getClinicalFileDownloadUrl: vi.fn(),
}));
vi.mock("../../../lib/services/patientService", async (importOriginal) => ({
  // Constants (blood types, messages) stay real; database calls are mocked.
  ...(await importOriginal<typeof import("../../../lib/services/patientService")>()),
  updatePatientNotes: vi.fn(),
  updatePatientBackground: vi.fn(),
  fetchPatientDetails: vi.fn(),
  fetchPatientNotes: vi.fn(),
}));
vi.mock("../../../lib/services/bodyMeasurementService", () => ({
  getWeightTracking: vi.fn(),
  setWeightTracking: vi.fn(),
  listBodyMeasurements: vi.fn(),
  createBodyMeasurement: vi.fn(),
  updateBodyMeasurement: vi.fn(),
  deleteBodyMeasurement: vi.fn(),
}));
vi.mock("../../../lib/services/financeService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/services/financeService")>()),
  recordPayment: vi.fn(),
}));
vi.mock("../../../lib/services/prescriberService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/services/prescriberService")>()),
  fetchPrescriberProfile: vi.fn(),
  downloadSignature: vi.fn(),
  issuePrescription: vi.fn(),
  logPrescriptionShared: vi.fn(),
}));
// The builder has its own tests; here only that a PDF is produced matters.
vi.mock("../prescription/buildPrescriptionPdf", () => ({
  buildPrescriptionPdf: vi.fn(),
}));

const appointment: DashboardAppointment = {
  id: "appt-1",
  patientId: "patient-1",
  patientName: "Ana Pérez",
  service: "Valoración",
  date: "15 oct 2026",
  time: "10:30 AM",
  phone: "+525512345678",
  isNewPatient: true,
  status: "confirmed",
  durationMins: 30,
  reason: null,
  servicePrice: 800,
};

const storedPayment: Payment = {
  id: "pay-1",
  appointmentId: "appt-1",
  patientId: "patient-1",
  serviceId: "svc-1",
  listPrice: 800,
  amountCharged: 800,
  status: "paid",
  method: "cash",
  note: null,
  createdAt: "2026-10-15T16:30:00Z",
  updatedAt: "2026-10-15T16:30:00Z",
};

const details: PatientDetails = {
  id: "patient-1",
  first_name: "Ana",
  last_name: "Pérez",
  phone: "+525512345678",
  email: null,
  gender: "Femenino",
  dob: "1958-01-10",
  blood_type: "O+",
  allergies: "Penicilina",
  chronic_conditions: null,
  address: null,
  family_history: "Madre con diabetes",
  personal_pathological_history: null,
  non_pathological_history: null,
  current_illness: "Manchas en mejillas",
  anonymized_at: null,
};

const note = (over: Partial<SoapNote> = {}): SoapNote => ({
  id: "note-1",
  appointmentId: "appt-0",
  patientId: "patient-1",
  subjective: "Revisión",
  objective: "Piel sin lesiones",
  analysis: "Melasma",
  plan: "Protector solar",
  prognosis: "Favorable",
  vitalSigns: null,
  createdAt: "2026-09-10T16:05:00Z",
  authorName: "Laura Garza",
  finalizedAt: "2026-09-10T17:00:00Z",
  addenda: [],
  ...over,
});

const prescription = (over: Partial<Prescription> = {}): Prescription => ({
  id: "rx-1",
  appointmentId: "appt-0",
  patientId: "patient-1",
  medications: [
    { nombre: "Ibuprofeno", dosis: "400 mg", indicaciones: "1 tableta cada 8 h" },
  ],
  createdAt: "2026-09-10T16:05:00Z",
  finalizedAt: "2026-09-10T17:00:00Z",
  ...over,
});

const reviewPatient: DashboardPatient = {
  id: "patient-1",
  name: "Ana Pérez",
  phone: "+525512345678",
  status: "active",
  totalVisits: 3,
  lastVisit: null,
  notes: "",
  hasPrivacyConsent: true,
};

/** Diagnosis and plan are required to finalize. */
const fillRequiredNote = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText("A - Diagnóstico (Análisis)"), "Paciente sano");
  await user.type(screen.getByLabelText("P - Tratamiento (Plan)"), "Alta");
};

const renderWorkspace = (props: Partial<Parameters<typeof ConsultationWorkspace>[0]> = {}) => {
  const onClose = vi.fn();
  const onFinishConsultation = vi.fn();
  render(
    <ConsultationWorkspace
      appointment={appointment}
      onClose={onClose}
      onFinishConsultation={onFinishConsultation}
      {...props}
    />,
  );
  return { onClose, onFinishConsultation, user: userEvent.setup() };
};

const backButton = () => screen.getByRole("button", { name: "Guardar borrador y volver" });

/** Waits until the history (and any draft) is loaded and the editor unlocked. */
const waitForHistory = async () => {
  await waitFor(() => expect(fetchPatientHistory).toHaveBeenCalledWith("patient-1"));
  await waitFor(() => expect(backButton()).toBeEnabled());
};

/** A promise the test resolves by hand, to hold the workspace in "loading". */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const chargeDialogTitle = () => screen.queryByText("Cobro de la consulta");

/** Diagnosis + plan -> "Finalizar Consulta" -> charge step -> "Guardar y finalizar". */
const finishWithCharge = async (
  user: ReturnType<typeof userEvent.setup>,
  choice: "Efectivo" | "cortesia" = "Efectivo",
) => {
  await fillRequiredNote(user);
  await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));
  await screen.findByText("Cobro de la consulta");
  await user.click(
    screen.getByRole("radio", {
      name: choice === "cortesia" ? "No cobré (cortesía)" : choice,
    }),
  );
  await user.click(screen.getByRole("button", { name: /Guardar y finalizar/ }));
};

beforeEach(() => {
  vi.mocked(fetchPatientHistory).mockResolvedValue({ notes: [], prescriptions: [] });
  vi.mocked(getPatientFiles).mockResolvedValue([]);
  vi.mocked(saveSoapNote).mockResolvedValue();
  vi.mocked(savePrescription).mockResolvedValue();
  vi.mocked(updatePatientNotes).mockResolvedValue();
  vi.mocked(updatePatientBackground).mockResolvedValue();
  vi.mocked(finalizeConsultation).mockResolvedValue();
  vi.mocked(finalizeConsultationWithPayment).mockResolvedValue();
  vi.mocked(fetchPatientDetails).mockResolvedValue(details);
  vi.mocked(fetchPatientNotes).mockResolvedValue("");
  vi.mocked(recordPayment).mockResolvedValue(storedPayment);
  vi.mocked(getWeightTracking).mockResolvedValue(false);
  vi.mocked(setWeightTracking).mockResolvedValue();
  vi.mocked(listBodyMeasurements).mockResolvedValue([]);
});

describe("ConsultationWorkspace", () => {
  it("back arrow saves a DRAFT and never finalizes the consultation", async () => {
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: "Guardar borrador y volver" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Nothing the doctor did not write is saved (no default boilerplate).
    expect(saveSoapNote).toHaveBeenCalledWith("appt-1", "patient-1", {
      subjective: "",
      objective: "",
      analysis: "",
      plan: "",
      prognosis: "",
      vitalSigns: null,
    });
    expect(savePrescription).toHaveBeenCalledWith("appt-1", "patient-1", []);
    expect(finalizeConsultation).not.toHaveBeenCalled();
    expect(onFinishConsultation).not.toHaveBeenCalled();
  });

  it("back arrow never asks for a charge and never records one", async () => {
    const { onClose, user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: "Guardar borrador y volver" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(chargeDialogTitle()).toBeNull();
    expect(recordPayment).not.toHaveBeenCalled();
    expect(finalizeConsultation).not.toHaveBeenCalled();
  });

  it('"Finalizar Consulta" first opens the charge step and finalizes nothing yet', async () => {
    const { onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await fillRequiredNote(user);
    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));

    expect(await screen.findByText("Cobro de la consulta")).toBeInTheDocument();
    // Pre-filled with the service price.
    expect(screen.getByLabelText("¿Cuánto cobraste? (MXN)")).toHaveValue(800);
    expect(recordPayment).not.toHaveBeenCalled();
    expect(saveSoapNote).not.toHaveBeenCalled();
    expect(finalizeConsultationWithPayment).not.toHaveBeenCalled();
    expect(onFinishConsultation).not.toHaveBeenCalled();
  });

  it('"Finalizar Consulta" saves the draft, then charges and finalizes in ONE call', async () => {
    const toastSuccess = vi.spyOn(toast, "success");
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finishWithCharge(user);

    await waitFor(() => expect(onFinishConsultation).toHaveBeenCalledWith("appt-1"));
    expect(finalizeConsultationWithPayment).toHaveBeenCalledTimes(1);
    expect(finalizeConsultationWithPayment).toHaveBeenCalledWith("appt-1", {
      status: "paid",
      amount: 800,
      method: "cash",
      note: "",
      supplies: [],
    });
    // The separate, non-atomic calls are never used.
    expect(recordPayment).not.toHaveBeenCalled();
    expect(finalizeConsultation).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalledWith("Cobro guardado");
    const saved = vi.mocked(saveSoapNote).mock.invocationCallOrder[0];
    const finalized = vi.mocked(finalizeConsultationWithPayment).mock.invocationCallOrder[0];
    expect(saved).toBeLessThan(finalized);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("when charge + finalize fails nothing is reported as saved, the error is shown, and a retry works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    const toastSuccess = vi.spyOn(toast, "success");
    vi.mocked(finalizeConsultationWithPayment).mockRejectedValueOnce(
      new Error("No se pudo finalizar la consulta. No se guardó nada; intenta de nuevo."),
    );
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finishWithCharge(user);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "No se pudo finalizar la consulta. No se guardó nada; intenta de nuevo.",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalledWith("Cobro guardado");
    expect(onFinishConsultation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(chargeDialogTitle()).toBeInTheDocument();

    // Retry from the same charge step.
    const confirm = screen.getByRole("button", { name: /Guardar y finalizar/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(onFinishConsultation).toHaveBeenCalledWith("appt-1"));
    expect(finalizeConsultationWithPayment).toHaveBeenCalledTimes(2);
  });

  it("hands the supplies of the appointment's service to the same finalize call", async () => {
    supabaseMock.onFrom("inventory", {
      data: [
        {
          id: "item-s", name: "Sculptra", category: "Medicamentos", stock_quantity: 3,
          min_alert_level: 1, unit_measure: "viales", last_restock_date: "2026-09-01", is_active: true,
        },
      ],
    });
    supabaseMock.onFrom("service_supplies", {
      data: [{ item_id: "item-s", quantity: 1, inventory: { name: "Sculptra", unit_measure: "viales" } }],
    });
    const { onFinishConsultation, user } = renderWorkspace({
      appointment: { ...appointment, serviceId: "svc-1" },
    });
    await waitForHistory();

    await fillRequiredNote(user);
    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));
    expect(await screen.findByLabelText("Cantidad de Sculptra")).toHaveValue(1);
    expect(supabaseMock.queries("service_supplies")[0].args("eq")).toEqual(["service_id", "svc-1"]);
    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    await user.click(screen.getByRole("button", { name: /Guardar y finalizar/ }));

    await waitFor(() => expect(onFinishConsultation).toHaveBeenCalledWith("appt-1"));
    expect(finalizeConsultationWithPayment).toHaveBeenCalledWith(
      "appt-1",
      expect.objectContaining({ supplies: [{ itemId: "item-s", quantity: 1 }] }),
    );
  });

  it("closes after finalizing when no finish handler is given", async () => {
    const { onClose, user } = renderWorkspace({ onFinishConsultation: undefined });
    await waitForHistory();

    await finishWithCharge(user, "cortesia");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(finalizeConsultationWithPayment).toHaveBeenCalledWith(
      "appt-1",
      expect.objectContaining({ status: "courtesy" }),
    );
  });

  it("does not charge or finalize when saving the note fails, and shows the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    vi.mocked(saveSoapNote).mockRejectedValue(new Error("Esta consulta ya fue finalizada."));
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finishWithCharge(user);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Esta consulta ya fue finalizada."),
    );
    expect(finalizeConsultationWithPayment).not.toHaveBeenCalled();
    expect(recordPayment).not.toHaveBeenCalled();
    expect(onFinishConsultation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The doctor can try again.
    expect(screen.getByRole("button", { name: /Finalizar Consulta/ })).toBeEnabled();
  });

  it("in review mode (no appointment) neither saves notes nor finalizes", async () => {
    const { onClose, user } = renderWorkspace({
      appointment: undefined,
      patient: reviewPatient,
    });
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: "Cerrar Expediente" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveSoapNote).not.toHaveBeenCalled();
    expect(finalizeConsultationWithPayment).not.toHaveBeenCalled();
    expect(recordPayment).not.toHaveBeenCalled();
    expect(chargeDialogTitle()).toBeNull();
  });
});

describe("ConsultationWorkspace loading and state", () => {
  it("locks the editor until the saved draft is loaded, then shows the draft", async () => {
    const history = deferred<Awaited<ReturnType<typeof fetchPatientHistory>>>();
    vi.mocked(fetchPatientHistory).mockReturnValue(history.promise);
    renderWorkspace();

    await waitFor(() => expect(fetchPatientHistory).toHaveBeenCalled());
    for (const label of [
      "S - Motivo y Síntomas",
      "O - Exploración Física",
      "A - Diagnóstico (Análisis)",
      "Pronóstico",
      "P - Tratamiento (Plan)",
      "Presión sistólica",
      "Presión diastólica",
      "Oxigenación",
      "Peso",
      "Talla",
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByPlaceholderText("Anota detalles administrativos aquí...")).toBeDisabled();
    expect(backButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: /Finalizar Consulta/ })).toBeDisabled();

    history.resolve({
      notes: [
        note({ id: "draft", appointmentId: "appt-1", subjective: "Refiere manchas", finalizedAt: null }),
      ],
      prescriptions: [],
    });

    expect(await screen.findByDisplayValue("Refiere manchas")).toBeEnabled();
    expect(screen.getByLabelText("Presión sistólica")).toBeEnabled();
    expect(backButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: /Finalizar Consulta/ })).toBeEnabled();
  });

  it("stays locked when the record cannot be loaded, and leaving never overwrites the draft", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    vi.mocked(fetchPatientHistory).mockRejectedValue(new Error("network"));
    const { onClose, user } = renderWorkspace();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Error al cargar el expediente. Cierra y vuelve a abrir la consulta.",
      ),
    );
    expect(screen.getByLabelText("A - Diagnóstico (Análisis)")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Finalizar Consulta/ })).toBeDisabled();

    await user.click(backButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saveSoapNote).not.toHaveBeenCalled();
    expect(savePrescription).not.toHaveBeenCalled();
    expect(updatePatientNotes).not.toHaveBeenCalled();
  });

  it("opens with the saved reminders and does not write them back unchanged", async () => {
    vi.mocked(fetchPatientNotes).mockResolvedValue("Paga en efectivo");
    const { onClose, user } = renderWorkspace();
    await waitForHistory();

    expect(screen.getByPlaceholderText("Anota detalles administrativos aquí...")).toHaveValue(
      "Paga en efectivo",
    );
    await user.click(backButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updatePatientNotes).not.toHaveBeenCalled();
  });

  it("saves the reminders only when the doctor changed them", async () => {
    vi.mocked(fetchPatientNotes).mockResolvedValue("Paga en efectivo");
    const { onClose, user } = renderWorkspace();
    await waitForHistory();

    await user.type(
      screen.getByPlaceholderText("Anota detalles administrativos aquí..."),
      ". Llega tarde",
    );
    await user.click(backButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updatePatientNotes).toHaveBeenCalledWith(
      "patient-1",
      "Paga en efectivo. Llega tarde",
    );
  });

  it("keyed by appointment (as it is mounted), switching consultations resets the editor", async () => {
    vi.mocked(fetchPatientHistory).mockImplementation(async () => ({
      notes: [],
      prescriptions: [],
    }));
    const props = { onClose: vi.fn(), onFinishConsultation: vi.fn() };
    const other: DashboardAppointment = { ...appointment, id: "appt-2", patientName: "Rosa Treviño" };
    const { rerender } = render(
      <ConsultationWorkspace key={appointment.id} appointment={appointment} {...props} />,
    );
    const user = userEvent.setup();
    await waitForHistory();
    await user.type(screen.getByLabelText("A - Diagnóstico (Análisis)"), "Texto de Ana");

    rerender(<ConsultationWorkspace key={other.id} appointment={other} {...props} />);

    expect(await screen.findByText("Rosa Treviño")).toBeInTheDocument();
    await waitFor(() => expect(backButton()).toBeEnabled());
    expect(screen.getByLabelText("A - Diagnóstico (Análisis)")).toHaveValue("");
  });
});

describe("ConsultationWorkspace NOM-004 record", () => {
  it("does not finalize or charge without a diagnosis and a plan, and says why", async () => {
    const toastError = vi.spyOn(toast, "error");
    const { onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));
    expect(toastError).toHaveBeenCalledWith(
      "Para finalizar la consulta, escribe el diagnóstico y el plan.",
    );
    expect(chargeDialogTitle()).toBeNull();

    // A diagnosis alone is not enough; whitespace does not count as a plan.
    await user.type(screen.getByLabelText("A - Diagnóstico (Análisis)"), "Paciente sano");
    await user.type(screen.getByLabelText("P - Tratamiento (Plan)"), "   ");
    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));

    expect(toastError).toHaveBeenCalledTimes(2);
    expect(chargeDialogTitle()).toBeNull();
    expect(recordPayment).not.toHaveBeenCalled();
    expect(saveSoapNote).not.toHaveBeenCalled();
    expect(finalizeConsultation).not.toHaveBeenCalled();
    expect(onFinishConsultation).not.toHaveBeenCalled();
  });

  it("starts with empty fields and example placeholders instead of frozen text", async () => {
    renderWorkspace({ appointment: { ...appointment, isNewPatient: false } });
    await waitForHistory();

    const subjective = screen.getByLabelText("S - Motivo y Síntomas");
    expect(subjective).toHaveValue("");
    expect(subjective).toHaveAttribute("placeholder", "Ej. Acude a revisión. Refiere...");
    expect(screen.getByLabelText("A - Diagnóstico (Análisis)")).toHaveAttribute(
      "placeholder",
      "Ej. Paciente sano, sin hallazgos",
    );
    expect(screen.getByLabelText("Pronóstico")).toHaveAttribute("placeholder", "Ej. Favorable");
    expect(screen.getByLabelText("P - Tratamiento (Plan)")).toHaveAttribute(
      "placeholder",
      "Ej. Alta · Sin tratamiento · Revisión en 6 meses",
    );
  });

  it("vital signs start empty with neutral placeholders that cannot pass for data", async () => {
    renderWorkspace();
    await waitForHistory();

    for (const label of ["Presión sistólica", "Presión diastólica", "Oxigenación", "Peso"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveValue("");
      expect(field).toHaveAttribute("placeholder", "—");
      expect(field.className).toMatch(/placeholder:font-normal/);
    }
    expect(screen.getByLabelText("Talla")).toHaveAttribute("placeholder", "Opcional");
    expect(screen.queryByPlaceholderText("120")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("80")).not.toBeInTheDocument();
  });

  it("saves prognosis and vital signs as data, keeping the diastolic value", async () => {
    const { onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await user.type(screen.getByLabelText("Pronóstico"), "Favorable");
    await user.type(screen.getByLabelText("Presión sistólica"), "120");
    await user.type(screen.getByLabelText("Presión diastólica"), "80");
    await user.type(screen.getByLabelText("Oxigenación"), "98");
    await user.type(screen.getByLabelText("Peso"), "70.5");
    await finishWithCharge(user);

    await waitFor(() => expect(onFinishConsultation).toHaveBeenCalledWith("appt-1"));
    expect(saveSoapNote).toHaveBeenCalledWith("appt-1", "patient-1", {
      subjective: "",
      // Vital signs are no longer prefixed into the examination text.
      objective: "",
      analysis: "Paciente sano",
      plan: "Alta",
      prognosis: "Favorable",
      vitalSigns: { bp_sys: 120, bp_dia: 80, spo2: 98, weight_kg: 70.5 },
    });
  });

  it("does not save an impossible vital sign", async () => {
    const toastError = vi.spyOn(toast, "error");
    const { onClose, user } = renderWorkspace();
    await waitForHistory();

    await user.type(screen.getByLabelText("Presión sistólica"), "120");
    await user.click(screen.getByRole("button", { name: "Guardar borrador y volver" }));

    expect(toastError).toHaveBeenCalledWith("Escribe las dos cifras de la presión arterial.");
    expect(saveSoapNote).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reopens a saved draft instead of starting blank, and saves over it", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [
        note(),
        note({
          id: "draft",
          appointmentId: "appt-1",
          subjective: "Refiere manchas",
          objective: "",
          analysis: "Melasma",
          plan: "",
          prognosis: "Bueno",
          vitalSigns: { bp_sys: 118, bp_dia: 76, height_cm: 160 },
          finalizedAt: null,
        }),
      ],
      prescriptions: [
        prescription(),
        prescription({
          id: "rx-draft",
          appointmentId: "appt-1",
          medications: [{ nombre: "Hidroquinona", dosis: "4 %", indicaciones: "Noche" }],
          finalizedAt: null,
        }),
      ],
    });
    const { onClose, user } = renderWorkspace();

    expect(await screen.findByDisplayValue("Refiere manchas")).toBeInTheDocument();
    expect(screen.getByLabelText("A - Diagnóstico (Análisis)")).toHaveValue("Melasma");
    expect(screen.getByLabelText("Pronóstico")).toHaveValue("Bueno");
    expect(screen.getByLabelText("Presión sistólica")).toHaveValue("118");
    expect(screen.getByLabelText("Presión diastólica")).toHaveValue("76");
    expect(screen.getByLabelText("Talla")).toHaveValue("160");

    await user.click(screen.getByRole("button", { name: "Guardar borrador y volver" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveSoapNote).toHaveBeenCalledWith("appt-1", "patient-1", {
      subjective: "Refiere manchas",
      objective: "",
      analysis: "Melasma",
      plan: "",
      prognosis: "Bueno",
      vitalSigns: { bp_sys: 118, bp_dia: 76, height_cm: 160 },
    });
    expect(savePrescription).toHaveBeenCalledWith("appt-1", "patient-1", [
      { nombre: "Hidroquinona", dosis: "4 %", indicaciones: "Noche" },
    ]);
  });

  it("keeps the draft out of the past-visit lists", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [
        note({ id: "draft", appointmentId: "appt-1", analysis: "Borrador", finalizedAt: null }),
      ],
      prescriptions: [
        prescription({
          id: "rx-draft",
          appointmentId: "appt-1",
          medications: [{ nombre: "Hidroquinona", dosis: "4 %", indicaciones: "Noche" }],
          finalizedAt: null,
        }),
      ],
    });
    const { user } = renderWorkspace();
    await screen.findByDisplayValue("Borrador");

    expect(screen.getByText("No hay visitas previas.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    // Shown once, as today's prescription, with nothing to copy.
    expect(screen.getAllByText("Hidroquinona")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Copiar/ })).not.toBeInTheDocument();
  });

  it("Copiar adds a past medication to the prescription of today and saves it", async () => {
    const toastSuccess = vi.spyOn(toast, "success");
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [],
      prescriptions: [prescription()],
    });
    const { onClose, user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    const copy = await screen.findByRole("button", {
      name: "Copiar Ibuprofeno a la receta de hoy",
    });
    await user.click(copy);

    expect(toastSuccess).toHaveBeenCalledWith("Ibuprofeno copiado a la receta de hoy.");
    expect(screen.getByText("Emitida: HOY")).toBeInTheDocument();

    // Copying it again does not duplicate it.
    await user.click(copy);
    expect(screen.getAllByText("Emitida: HOY")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Guardar borrador y volver" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(savePrescription).toHaveBeenCalledWith("appt-1", "patient-1", [
      { nombre: "Ibuprofeno", dosis: "400 mg", indicaciones: "1 tableta cada 8 h" },
    ]);
  });

  it("groups past medications by prescription, and Copiar todo copies the whole one", async () => {
    const toastSuccess = vi.spyOn(toast, "success");
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [],
      prescriptions: [
        prescription({
          id: "rx-2",
          createdAt: "2026-09-10T16:05:00Z",
          medications: [
            { nombre: "Ibuprofeno", dosis: "400 mg", indicaciones: "1 tableta cada 8 h" },
            { nombre: "Hidroquinona", dosis: "4 %", indicaciones: "Noche" },
            { nombre: "Protector solar", dosis: "FPS 50", indicaciones: "Cada 3 h" },
          ],
        }),
        prescription({ id: "rx-1", createdAt: "2026-08-01T16:05:00Z" }),
      ],
    });
    const { onClose, user } = renderWorkspace();
    await waitForHistory();
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));

    const date = (iso: string) => new Date(iso).toLocaleDateString("es-MX");
    const latest = screen.getByRole("region", { name: `Receta del ${date("2026-09-10T16:05:00Z")}` });
    const older = screen.getByRole("region", { name: `Receta del ${date("2026-08-01T16:05:00Z")}` });
    expect(within(latest).getAllByRole("button", { name: /^Copiar .* a la receta de hoy$/ })).toHaveLength(3);
    expect(within(older).getAllByRole("button", { name: /^Copiar .* a la receta de hoy$/ })).toHaveLength(1);

    // One medication first, then the whole prescription: the repeated one is skipped.
    await user.click(within(latest).getByRole("button", { name: "Copiar Ibuprofeno a la receta de hoy" }));
    await user.click(within(latest).getByRole("button", { name: /Copiar toda la receta/ }));

    expect(toastSuccess).toHaveBeenLastCalledWith("Se agregaron 2 medicamentos a la receta de hoy.");
    expect(screen.getAllByText("Emitida: HOY")).toHaveLength(3);

    await user.click(within(latest).getByRole("button", { name: /Copiar toda la receta/ }));
    expect(screen.getAllByText("Emitida: HOY")).toHaveLength(3);

    await user.click(backButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(savePrescription).toHaveBeenCalledWith("appt-1", "patient-1", [
      { nombre: "Ibuprofeno", dosis: "400 mg", indicaciones: "1 tableta cada 8 h" },
      { nombre: "Hidroquinona", dosis: "4 %", indicaciones: "Noche" },
      { nombre: "Protector solar", dosis: "FPS 50", indicaciones: "Cada 3 h" },
    ]);
  });

  it("copy buttons are always visible (no hover needed on a tablet)", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({ notes: [], prescriptions: [prescription()] });
    const { user } = renderWorkspace();
    await waitForHistory();
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));

    for (const button of screen.getAllByRole("button", { name: /^Copiar/ })) {
      expect(button.className).not.toMatch(/opacity-0/);
    }
  });

  it("marks a copied old medication as incomplete and Completar fills in route and frequency", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [],
      prescriptions: [prescription()],
    });
    const { onClose, user } = renderWorkspace();
    await waitForHistory();
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    await user.click(
      await screen.findByRole("button", { name: "Copiar Ibuprofeno a la receta de hoy" }),
    );

    expect(screen.getByText("Incompleto: falta la vía o la frecuencia.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Completar Ibuprofeno" }));

    // The same form, prefilled with what the old item has.
    expect(
      await screen.findByRole("heading", { name: "Completar Indicación Médica" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Medicamento \(nombre genérico\)/)).toHaveValue("Ibuprofeno");
    expect(screen.getByLabelText(/^Dosis/)).toHaveValue("400 mg");
    expect(screen.getByLabelText("Indicaciones")).toHaveValue("1 tableta cada 8 h");

    await user.click(screen.getByRole("combobox", { name: /Vía/ }));
    await user.click(screen.getByRole("option", { name: "Oral" }));
    await user.type(screen.getByLabelText(/^Frecuencia/), "Cada 8 horas");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Incompleto: falta la vía o la frecuencia."),
      ).not.toBeInTheDocument(),
    );
    // Replaced in place, not added again.
    expect(screen.getAllByText("Emitida: HOY")).toHaveLength(1);

    await user.click(backButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(savePrescription).toHaveBeenCalledWith("appt-1", "patient-1", [
      {
        nombre: "Ibuprofeno",
        dosis: "400 mg",
        via: "Oral",
        frecuencia: "Cada 8 horas",
        indicaciones: "1 tableta cada 8 h",
      },
    ]);
  });

  it("does not finalize while a medication of today is incomplete, and says which one", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [],
      prescriptions: [prescription()],
    });
    const toastError = vi.spyOn(toast, "error");
    const { user } = renderWorkspace();
    await waitForHistory();
    await fillRequiredNote(user);
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    await user.click(
      await screen.findByRole("button", { name: "Copiar Ibuprofeno a la receta de hoy" }),
    );

    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));

    expect(toastError).toHaveBeenCalledWith(
      "Completa la vía y la frecuencia de: Ibuprofeno. Toca «Completar» en Recetas e Indicaciones.",
    );
    expect(chargeDialogTitle()).not.toBeInTheDocument();
    expect(finalizeConsultationWithPayment).not.toHaveBeenCalled();
    // She is taken to the prescription, where the button is.
    expect(screen.getByRole("button", { name: "Completar Ibuprofeno" })).toBeInTheDocument();

    // A draft can still be saved with the incomplete item.
    await user.click(backButton());
    await waitFor(() => expect(savePrescription).toHaveBeenCalled());
  });

  it("caps today's prescription at 30 medications with a clear message", async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => ({
      nombre: `Medicamento ${i + 1}`,
      dosis: "1",
      via: "Oral",
      frecuencia: "Cada 8 h",
      indicaciones: "",
    }));
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [],
      prescriptions: [
        prescription(),
        prescription({ id: "rx-draft", appointmentId: "appt-1", medications: thirty, finalizedAt: null }),
      ],
    });
    const toastError = vi.spyOn(toast, "error");
    const { user } = renderWorkspace();
    await waitForHistory();
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    expect(await screen.findAllByText("Emitida: HOY")).toHaveLength(30);

    await user.click(screen.getByRole("button", { name: /Nueva Indicación/ }));
    expect(toastError).toHaveBeenLastCalledWith("La receta admite hasta 30 medicamentos.");
    expect(screen.queryByRole("heading", { name: "Nueva Indicación Médica" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copiar Ibuprofeno a la receta de hoy" }));
    expect(toastError).toHaveBeenLastCalledWith("La receta admite hasta 30 medicamentos.");

    await user.click(screen.getByRole("button", { name: /Copiar toda la receta/ }));
    expect(toastError).toHaveBeenLastCalledWith(
      "La receta admite hasta 30 medicamentos. No se copió esta receta: quedan 0 lugares.",
    );
    expect(screen.getAllByText("Emitida: HOY")).toHaveLength(30);
  });

  it("Nueva Indicación requires medication, dose, route and frequency", async () => {
    const { user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    await user.click(screen.getByRole("button", { name: /Nueva Indicación/ }));
    await user.click(screen.getByRole("button", { name: "Añadir a la Receta" }));

    expect(screen.getByText("Escribe el nombre del medicamento.")).toBeInTheDocument();
    expect(screen.getByText("Escribe la dosis.")).toBeInTheDocument();
    expect(screen.getByText("Elige la vía.")).toBeInTheDocument();
    expect(screen.getByText("Escribe cada cuánto se toma.")).toBeInTheDocument();
    expect(screen.queryByText("Emitida: HOY")).not.toBeInTheDocument();
    // The controlled-substance warning is on the form.
    expect(
      screen.getByText("No recetes aquí medicamentos controlados (Grupos I a III)."),
    ).toBeInTheDocument();
  });

  it("Nueva Indicación adds a structured medication and saves it with the draft", async () => {
    const { onClose, user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    await user.click(screen.getByRole("button", { name: /Nueva Indicación/ }));
    await user.type(screen.getByLabelText(/Medicamento \(nombre genérico\)/), "Ibuprofeno");
    await user.type(screen.getByLabelText("Presentación"), "Tabletas de 400 mg");
    await user.type(screen.getByLabelText(/^Dosis/), "1 tableta");
    await user.click(screen.getByRole("combobox", { name: /Vía/ }));
    await user.click(screen.getByRole("option", { name: "Oral" }));
    await user.type(screen.getByLabelText(/^Frecuencia/), "Cada 8 horas");
    await user.type(screen.getByLabelText("Duración"), "5 días");
    await user.type(screen.getByLabelText("Indicaciones"), "Con alimentos");
    await user.click(screen.getByRole("button", { name: "Añadir a la Receta" }));

    expect(await screen.findByText("Emitida: HOY")).toBeInTheDocument();
    expect(
      screen.getByText("Tabletas de 400 mg · Vía oral · Cada 8 horas · Por 5 días"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Podrás enviar la receta en PDF al finalizar/)).toBeInTheDocument();

    await user.click(backButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(savePrescription).toHaveBeenCalledWith("appt-1", "patient-1", [
      {
        nombre: "Ibuprofeno",
        presentacion: "Tabletas de 400 mg",
        dosis: "1 tableta",
        via: "Oral",
        frecuencia: "Cada 8 horas",
        duracion: "5 días",
        indicaciones: "Con alimentos",
      },
    ]);
  });

  it("offers the prescription PDF only on finalized prescriptions", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [],
      prescriptions: [
        prescription({ id: "rx-final" }),
        prescription({
          id: "rx-draft",
          appointmentId: "appt-1",
          medications: [{ nombre: "Hidroquinona", dosis: "4 %", indicaciones: "Noche" }],
          finalizedAt: null,
        }),
      ],
    });
    const { user } = renderWorkspace();
    await waitForHistory();
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));

    expect(screen.getAllByRole("button", { name: /^Ver o imprimir la receta/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Enviar por WhatsApp la receta/ })).toHaveLength(1);
    // The old item (no structured fields) still shows its dose and indications.
    expect(screen.getByText("Ibuprofeno")).toBeInTheDocument();
    expect(screen.getByText("1 tableta cada 8 h")).toBeInTheDocument();
  });

  it("offers the prescription PDF in review mode too, but not for an anonymized record", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [],
      prescriptions: [prescription()],
    });
    const user = userEvent.setup();
    const { unmount } = render(
      <ConsultationWorkspace patient={reviewPatient} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(fetchPatientHistory).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    expect(
      await screen.findByRole("button", { name: /^Enviar por WhatsApp la receta/ }),
    ).toBeInTheDocument();
    unmount();

    vi.mocked(fetchPatientDetails).mockResolvedValue({
      ...details,
      anonymized_at: "2026-01-01T00:00:00Z",
    });
    render(<ConsultationWorkspace patient={reviewPatient} onClose={vi.fn()} />);
    await screen.findByText(ANONYMIZED_PATIENT_MESSAGE);
    await user.click(screen.getByRole("button", { name: /Recetas e Indicaciones/ }));
    expect(screen.getByText("Ibuprofeno")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Enviar por WhatsApp la receta/ }),
    ).not.toBeInTheDocument();
  });

  it("shows age, sex and the clinical background next to the patient name", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 27, 12, 0));
    try {
      renderWorkspace();
      await waitForHistory();

      expect(await screen.findByText("68 años · Femenino")).toBeInTheDocument();
      expect(screen.getByText("Tipo de sangre")).toBeInTheDocument();
      expect(screen.getByText("O+")).toBeInTheDocument();
      expect(screen.getByText("Penicilina")).toBeInTheDocument();
      expect(screen.getByText("Heredofamiliares")).toBeInTheDocument();
      expect(screen.getByText("Madre con diabetes")).toBeInTheDocument();
      expect(screen.getByText("Manchas en mejillas")).toBeInTheDocument();
      // Empty fields are not listed.
      expect(screen.queryByText("Enfermedades crónicas")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a past note with date and time, author, prognosis and vital signs in full words", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [
        note({
          vitalSigns: { bp_sys: 120, bp_dia: 80, spo2: 98, weight_kg: 62, height_cm: 158 },
        }),
      ],
      prescriptions: [],
    });
    renderWorkspace({ appointment: undefined, patient: reviewPatient });

    const header = (await screen.findByText(/Mostrando expediente del:/)).parentElement!;
    const expectedDateTime = new Date("2026-09-10T16:05:00Z").toLocaleString("es-MX", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(header).toHaveTextContent(expectedDateTime);
    expect(within(header).getByText("Escrita por Laura Garza")).toBeInTheDocument();
    expect(await within(header).findByText(/^Ana Pérez · \d+ años · Femenino$/)).toBeInTheDocument();

    expect(screen.getByLabelText("Pronóstico")).toHaveValue("Favorable");
    expect(screen.getByText("Presión arterial 120/80 mmHg")).toBeInTheDocument();
    expect(screen.getByText("Oxigenación 98 %")).toBeInTheDocument();
    expect(screen.getByText("Peso 62 kg")).toBeInTheDocument();
    expect(screen.getByText("Talla 158 cm")).toBeInTheDocument();
    expect(screen.queryByText(/\bTA\b/)).not.toBeInTheDocument();
  });

  it("says when a past note has no recorded author", async () => {
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [note({ authorName: null })],
      prescriptions: [],
    });
    renderWorkspace({ appointment: undefined, patient: reviewPatient });

    expect(await screen.findByText("Autor no registrado")).toBeInTheDocument();
  });
});

describe("ConsultationWorkspace antecedentes", () => {
  const noBackground: PatientDetails = {
    ...details,
    blood_type: null,
    allergies: null,
    chronic_conditions: null,
    family_history: null,
    personal_pathological_history: null,
    non_pathological_history: null,
    current_illness: null,
  };
  const HINT = "Primera consulta: pregunta y registra sus antecedentes.";
  const HISTORY_LABELS = [
    "Heredofamiliares",
    "Personales patológicos",
    "Personales no patológicos",
    "Padecimiento actual",
  ];
  const editButton = () => screen.getByRole("button", { name: /Editar/ });
  const doneButton = () => screen.getByRole("button", { name: /Listo/ });
  const sidebarCard = () =>
    screen.getByRole("button", { name: /Editar/ }).closest("div.rounded-2xl") as HTMLElement;

  it("when recorded, are shown only in the sidebar (no edit card, no summary)", async () => {
    renderWorkspace();
    await waitForHistory();

    expect(await screen.findByText("Madre con diabetes")).toBeInTheDocument();
    expect(screen.queryByText(/Tipo de sangre: O\+/)).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Heredofamiliares")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Listo/ })).not.toBeInTheDocument();
    expect(within(sidebarCard()).getByText("Antecedentes")).toBeInTheDocument();
  });

  it("Editar in the sidebar opens the edit card prefilled; Listo closes it and keeps the edits for Guardar", async () => {
    const { onClose, user } = renderWorkspace();
    await waitForHistory();
    await screen.findByText("Madre con diabetes");

    await user.click(editButton());

    expect(screen.getByLabelText("Heredofamiliares")).toHaveValue("Madre con diabetes");
    expect(screen.getByLabelText("Alergias")).toHaveValue("Penicilina");
    expect(screen.getByRole("combobox", { name: "Tipo de sangre" })).toHaveTextContent("O+");
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    // Filled fields stay editable.
    const family = screen.getByLabelText("Heredofamiliares");
    expect(family).toBeEnabled();
    await user.type(family, ". Padre hipertenso");
    expect(family).toHaveValue("Madre con diabetes. Padre hipertenso");

    await user.click(doneButton());

    expect(screen.queryByLabelText("Heredofamiliares")).not.toBeInTheDocument();
    expect(screen.getByText("Madre con diabetes. Padre hipertenso")).toBeInTheDocument();
    expect(editButton()).toBeInTheDocument();

    await user.click(backButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updatePatientBackground).toHaveBeenCalledWith("patient-1", {
      family_history: "Madre con diabetes. Padre hipertenso",
    });
  });

  it('opens expanded with the first-visit hint when empty, suggesting "Ej. Negados" (optional)', async () => {
    vi.mocked(fetchPatientDetails).mockResolvedValue(noBackground);
    const { user } = renderWorkspace();
    await waitForHistory();

    expect(await screen.findByText(HINT)).toBeInTheDocument();
    for (const label of HISTORY_LABELS) {
      const field = screen.getByLabelText(label);
      expect(field).toBeEnabled();
      expect(field).toHaveAttribute("placeholder", "Ej. Negados");
      expect(field).not.toBeRequired();
    }
    expect(screen.getByLabelText("Alergias")).toBeEnabled();
    expect(screen.getByLabelText("Enfermedades crónicas")).toBeEnabled();
    // The card is already open: no Editar until it is closed.
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();

    await user.click(doneButton());

    expect(screen.queryByLabelText("Heredofamiliares")).not.toBeInTheDocument();
    expect(screen.getByText("Sin antecedentes registrados.")).toBeInTheDocument();
    await user.click(editButton());
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("are disabled until the workspace is loaded", async () => {
    vi.mocked(fetchPatientDetails).mockResolvedValue(noBackground);
    const history = deferred<Awaited<ReturnType<typeof fetchPatientHistory>>>();
    vi.mocked(fetchPatientHistory).mockReturnValue(history.promise);
    renderWorkspace();

    expect(await screen.findByText(HINT)).toBeInTheDocument();
    for (const label of [...HISTORY_LABELS, "Alergias", "Enfermedades crónicas"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }

    history.resolve({ notes: [], prescriptions: [] });

    await waitFor(() => expect(screen.getByLabelText("Heredofamiliares")).toBeEnabled());
  });

  it("are not written back when unchanged", async () => {
    const { onClose, user } = renderWorkspace();
    await waitForHistory();
    await screen.findByText("Madre con diabetes");

    await user.click(editButton());
    await user.click(backButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updatePatientBackground).not.toHaveBeenCalled();
  });

  it("Guardar saves only the antecedentes the doctor changed", async () => {
    vi.mocked(fetchPatientDetails).mockResolvedValue(noBackground);
    const { onClose, user } = renderWorkspace();
    await waitForHistory();
    await screen.findByText(HINT);

    await user.type(screen.getByLabelText("Heredofamiliares"), "Negados");
    await user.click(screen.getByRole("combobox", { name: "Tipo de sangre" }));
    await user.click(
      within(screen.getByRole("listbox", { name: "Tipo de sangre" })).getByRole("option", {
        name: "A+",
      }),
    );
    await user.click(backButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updatePatientBackground).toHaveBeenCalledTimes(1);
    expect(updatePatientBackground).toHaveBeenCalledWith("patient-1", {
      blood_type: "A+",
      family_history: "Negados",
    });
  });

  it("Finalizar saves changed antecedentes before freezing the note", async () => {
    vi.mocked(fetchPatientDetails).mockResolvedValue(noBackground);
    const { onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();
    await screen.findByText(HINT);

    await user.type(screen.getByLabelText("Personales patológicos"), "Negados");
    await finishWithCharge(user);

    await waitFor(() => expect(onFinishConsultation).toHaveBeenCalledWith("appt-1"));
    expect(updatePatientBackground).toHaveBeenCalledWith("patient-1", {
      personal_pathological_history: "Negados",
    });
    const saved = vi.mocked(updatePatientBackground).mock.invocationCallOrder[0];
    const finalized = vi.mocked(finalizeConsultationWithPayment).mock.invocationCallOrder[0];
    expect(saved).toBeLessThan(finalized);
  });

  it("a failed save shows a clear error and keeps the doctor on the screen", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    vi.mocked(fetchPatientDetails).mockResolvedValue(noBackground);
    vi.mocked(updatePatientBackground).mockRejectedValue(new Error("network"));
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();
    await screen.findByText(HINT);
    await user.type(screen.getByLabelText("Heredofamiliares"), "Negados");

    const message =
      "No se pudieron guardar los antecedentes. Revisa tu conexión e intenta de nuevo.";
    await user.click(backButton());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Heredofamiliares")).toHaveValue("Negados");

    await finishWithCharge(user);
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    expect(toastError).toHaveBeenLastCalledWith(message);
    expect(finalizeConsultationWithPayment).not.toHaveBeenCalled();
    expect(onFinishConsultation).not.toHaveBeenCalled();
    expect(chargeDialogTitle()).toBeInTheDocument();
  });

  it("are read-only in review mode", async () => {
    vi.mocked(fetchPatientDetails).mockResolvedValue(noBackground);
    renderWorkspace({ appointment: undefined, patient: reviewPatient });
    await waitForHistory();

    expect(await screen.findByText("Sin antecedentes registrados.")).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Listo/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Heredofamiliares")).not.toBeInTheDocument();
  });

  it("are read-only for an anonymized patient and never saved", async () => {
    vi.mocked(fetchPatientDetails).mockResolvedValue({
      ...noBackground,
      anonymized_at: "2026-01-01T00:00:00Z",
    });
    const { onClose, user } = renderWorkspace();
    await waitForHistory();

    expect(await screen.findByText(ANONYMIZED_PATIENT_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Heredofamiliares")).not.toBeInTheDocument();

    await user.click(backButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updatePatientBackground).not.toHaveBeenCalled();
  });
});

describe("ConsultationWorkspace weight tracking", () => {
  const weightTab = () => screen.queryByRole("button", { name: "Control de peso" });
  const turnOnButton = () =>
    screen.queryByRole("button", { name: "Llevar control de peso" });

  it("hides the tab and offers to start tracking when it is off", async () => {
    renderWorkspace();
    await waitForHistory();

    expect(await screen.findByRole("button", { name: "Llevar control de peso" })).toBeInTheDocument();
    expect(weightTab()).toBeNull();
    expect(getWeightTracking).toHaveBeenCalledWith("patient-1");
  });

  it("turns tracking on only after confirmation, then opens the tab", async () => {
    const { user } = renderWorkspace();
    await waitForHistory();

    await user.click(await screen.findByRole("button", { name: "Llevar control de peso" }));
    expect(setWeightTracking).not.toHaveBeenCalled();
    expect(screen.getByText("¿Llevar el control de peso de Ana Pérez?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sí, llevar control" }));

    await waitFor(() => expect(setWeightTracking).toHaveBeenCalledWith("patient-1", true));
    expect(await screen.findByText("Mediciones de la báscula InBody.")).toBeInTheDocument();
    expect(weightTab()).toBeInTheDocument();
    expect(turnOnButton()).toBeNull();
  });

  it("keeps the tab hidden when turning tracking on fails", async () => {
    vi.mocked(setWeightTracking).mockRejectedValue(new Error(ANONYMIZED_PATIENT_MESSAGE));
    const errorToast = vi.spyOn(toast, "error");
    const { user } = renderWorkspace();
    await waitForHistory();

    await user.click(await screen.findByRole("button", { name: "Llevar control de peso" }));
    await user.click(screen.getByRole("button", { name: "Sí, llevar control" }));

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(ANONYMIZED_PATIENT_MESSAGE));
    expect(weightTab()).toBeNull();
  });

  it("pre-fills a new measurement with the weight typed in the vital signs", async () => {
    vi.mocked(getWeightTracking).mockResolvedValue(true);
    const { user } = renderWorkspace();
    await waitForHistory();

    await user.type(screen.getByLabelText("Peso"), "71.2");
    await user.click(await screen.findByRole("button", { name: "Control de peso" }));
    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));

    expect(screen.getByLabelText(/Peso \(kg\)/)).toHaveValue("71.2");
  });

  it("shows the tab in review mode too, where measurements can still be added", async () => {
    vi.mocked(getWeightTracking).mockResolvedValue(true);
    const { user } = renderWorkspace({ appointment: undefined, patient: reviewPatient });

    await user.click(await screen.findByRole("button", { name: "Control de peso" }));

    expect(await screen.findByRole("button", { name: /Nueva medición/ })).toBeInTheDocument();
    expect(turnOnButton()).toBeNull();
  });

  it("stops tracking from the tab and hides it", async () => {
    vi.mocked(getWeightTracking).mockResolvedValue(true);
    const { user } = renderWorkspace();
    await waitForHistory();

    await user.click(await screen.findByRole("button", { name: "Control de peso" }));
    await user.click(await screen.findByRole("button", { name: "Dejar de llevar control" }));
    await user.click(screen.getByRole("button", { name: "Sí, dejar de llevarlo" }));

    await waitFor(() => expect(setWeightTracking).toHaveBeenCalledWith("patient-1", false));
    await waitFor(() => expect(weightTab()).toBeNull());
    expect(screen.getByLabelText("A - Diagnóstico (Análisis)")).toBeInTheDocument();
  });

  it("never offers tracking for an anonymized record", async () => {
    vi.mocked(fetchPatientDetails).mockResolvedValue({
      ...details,
      anonymized_at: "2026-01-01T00:00:00Z",
    });
    renderWorkspace({ appointment: undefined, patient: reviewPatient });

    await waitFor(() => expect(getWeightTracking).toHaveBeenCalled());
    await screen.findByText(ANONYMIZED_PATIENT_MESSAGE);
    expect(turnOnButton()).toBeNull();
  });

  it("offers no tracking change until the patient's details are read", async () => {
    let releaseDetails!: (value: PatientDetails) => void;
    vi.mocked(fetchPatientDetails).mockReturnValue(
      new Promise<PatientDetails>((resolve) => {
        releaseDetails = resolve;
      }),
    );
    renderWorkspace();
    await waitForHistory();
    await waitFor(() => expect(getWeightTracking).toHaveBeenCalled());

    // The flag is known (off) but "not anonymized" is not yet.
    expect(turnOnButton()).toBeNull();

    releaseDetails(details);

    expect(await screen.findByRole("button", { name: "Llevar control de peso" })).toBeInTheDocument();
  });

  it("keeps the tab read-only until the patient's details are read", async () => {
    vi.mocked(getWeightTracking).mockResolvedValue(true);
    let releaseDetails!: (value: PatientDetails) => void;
    vi.mocked(fetchPatientDetails).mockReturnValue(
      new Promise<PatientDetails>((resolve) => {
        releaseDetails = resolve;
      }),
    );
    const { user } = renderWorkspace();
    await waitForHistory();

    await user.click(await screen.findByRole("button", { name: "Control de peso" }));
    await screen.findByText("Mediciones de la báscula InBody.");
    expect(screen.queryByRole("button", { name: /Nueva medición/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dejar de llevar control" })).toBeNull();

    releaseDetails(details);

    expect(await screen.findByRole("button", { name: /Nueva medición/ })).toBeInTheDocument();
  });

  it("hides weight tracking when its flag cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getWeightTracking).mockRejectedValue(new Error("x"));
    renderWorkspace();
    await waitForHistory();

    await waitFor(() => expect(getWeightTracking).toHaveBeenCalled());
    expect(turnOnButton()).toBeNull();
    expect(weightTab()).toBeNull();
  });
});

describe("ConsultationWorkspace after finalizing", () => {
  const medication = {
    nombre: "Hidroquinona",
    dosis: "4 %",
    via: "Tópica",
    frecuencia: "Cada noche",
    indicaciones: "",
  };

  /** Today's draft: diagnosis, plan and the given medications. */
  const withDraft = (medications: (typeof medication)[]) =>
    vi.mocked(fetchPatientHistory).mockResolvedValue({
      notes: [
        note({ id: "draft", appointmentId: "appt-1", analysis: "Melasma", plan: "Protector", finalizedAt: null }),
      ],
      prescriptions:
        medications.length > 0
          ? [prescription({ id: "rx-today", appointmentId: "appt-1", medications, finalizedAt: null })]
          : [],
    });

  const finalizedToday = prescription({
    id: "rx-today",
    appointmentId: "appt-1",
    medications: [medication],
    finalizedAt: "2026-10-15T17:00:00Z",
  });

  /** "Finalizar Consulta" -> charge step -> "Guardar y finalizar" (note already filled). */
  const finalize = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));
    await screen.findByText("Cobro de la consulta");
    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    await user.click(screen.getByRole("button", { name: /Guardar y finalizar/ }));
  };

  const setNavigator = (share?: unknown, canShare?: unknown) => {
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
    Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true, writable: true });
  };

  beforeEach(() => {
    vi.mocked(fetchFinalizedPrescription).mockResolvedValue(finalizedToday);
    vi.mocked(issuePrescription).mockResolvedValue({
      folio: 123,
      issuedAt: "2026-10-15T17:05:00+00:00",
      signaturePath: "signature-1.png",
      prescriber: {
        fullName: "Dra. Carmen Torres",
        cedulaProfesional: "1234567",
        especialidad: "Dermatología",
        cedulaEspecialidad: "",
        institucionTitulo: "UANL",
        consultorioDomicilio: "Av. Constitución 100, Monterrey",
        telefono: "81 1234 5678",
      },
    });
    vi.mocked(downloadSignature).mockResolvedValue(
      new Blob([TEST_SIGNATURE_PNG], { type: "image/png" }),
    );
    vi.mocked(buildPrescriptionPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    vi.mocked(logPrescriptionShared).mockResolvedValue();
  });

  afterEach(() => {
    setNavigator(undefined, undefined);
  });

  it('with medications, stays open on "Consulta finalizada" with both actions until Listo', async () => {
    withDraft([medication]);
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finalize(user);

    const heading = await screen.findByRole("heading", { name: "Consulta finalizada" });
    const dialog = heading.closest("div.relative") as HTMLElement;
    // The dashboard marks it completed once and is told to keep it open.
    expect(onFinishConsultation).toHaveBeenCalledTimes(1);
    expect(onFinishConsultation).toHaveBeenCalledWith("appt-1", { keepOpen: true });
    expect(fetchFinalizedPrescription).toHaveBeenCalledWith("appt-1");
    expect(within(dialog).getByText("Hidroquinona")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^Enviar por WhatsApp la receta/ }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Ver o imprimir la receta/ })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Listo" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onFinishConsultation).toHaveBeenCalledTimes(1);
  });

  it('shares the prescription from "Consulta finalizada" and shows its folio', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator(share, vi.fn().mockReturnValue(true));
    withDraft([medication]);
    const { onClose, user } = renderWorkspace();
    await waitForHistory();
    await finalize(user);
    await screen.findByRole("heading", { name: "Consulta finalizada" });

    await user.click(screen.getByRole("button", { name: /^Enviar por WhatsApp la receta/ }));
    await screen.findByRole("heading", { name: "Enviar receta" });
    expect(screen.getByText(/Folio 000123/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(issuePrescription).toHaveBeenCalledWith("rx-today");
    await waitFor(() =>
      expect(logPrescriptionShared).toHaveBeenCalledWith("rx-today", "share_sheet"),
    );
    // Still on "Consulta finalizada" until Listo.
    expect(screen.getByRole("heading", { name: "Consulta finalizada" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("without medications, hands over to the dashboard right away (no dialog)", async () => {
    withDraft([]);
    const { onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finalize(user);

    await waitFor(() => expect(onFinishConsultation).toHaveBeenCalledTimes(1));
    expect(onFinishConsultation).toHaveBeenCalledWith("appt-1");
    expect(fetchFinalizedPrescription).not.toHaveBeenCalled();
    expect(screen.queryByText("Consulta finalizada")).toBeNull();
  });

  it("closes with a message when the finalized prescription cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    vi.mocked(fetchFinalizedPrescription).mockRejectedValue(new Error("network"));
    withDraft([medication]);
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finalize(user);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onFinishConsultation).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "No se pudo cargar la receta. Puedes enviarla desde el Calendario.",
    );
    expect(screen.queryByText("Consulta finalizada")).toBeNull();
  });
});
