import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import type { DashboardAppointment } from "../../../lib/services/clinicService";
import type { DashboardPatient } from "../../../lib/services/patientService";
import {
  fetchPatientHistory,
  finalizeConsultation,
  savePrescription,
  saveSoapNote,
} from "../../../lib/services/soapService";
import { getPatientFiles } from "../../../lib/services/storageService";
import { updatePatientNotes } from "../../../lib/services/patientService";
import { recordPayment, type Payment } from "../../../lib/services/financeService";
import { ConsultationWorkspace } from "./ConsultationWorkspace";

vi.mock("../../../lib/services/soapService", () => ({
  fetchPatientHistory: vi.fn(),
  saveSoapNote: vi.fn(),
  savePrescription: vi.fn(),
  finalizeConsultation: vi.fn(),
  addNoteAddendum: vi.fn(),
}));
vi.mock("../../../lib/services/storageService", () => ({
  getPatientFiles: vi.fn(),
  uploadPatientFile: vi.fn(),
  getClinicalFileDownloadUrl: vi.fn(),
}));
vi.mock("../../../lib/services/patientService", () => ({
  updatePatientNotes: vi.fn(),
}));
vi.mock("../../../lib/services/financeService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/services/financeService")>()),
  recordPayment: vi.fn(),
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

const waitForHistory = () =>
  waitFor(() => expect(fetchPatientHistory).toHaveBeenCalledWith("patient-1"));

const chargeDialogTitle = () => screen.queryByText("Cobro de la consulta");

/** "Finalizar Consulta" -> charge step -> "Guardar y finalizar". */
const finishWithCharge = async (
  user: ReturnType<typeof userEvent.setup>,
  choice: "Efectivo" | "cortesia" = "Efectivo",
) => {
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
  vi.mocked(finalizeConsultation).mockResolvedValue();
  vi.mocked(recordPayment).mockResolvedValue(storedPayment);
});

describe("ConsultationWorkspace", () => {
  it("back arrow saves a DRAFT and never finalizes the consultation", async () => {
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: "Guardar borrador y volver" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveSoapNote).toHaveBeenCalledWith("appt-1", "patient-1", "", "", "", "");
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

    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));

    expect(await screen.findByText("Cobro de la consulta")).toBeInTheDocument();
    // Pre-filled with the service price.
    expect(screen.getByLabelText("¿Cuánto cobraste? (MXN)")).toHaveValue(800);
    expect(recordPayment).not.toHaveBeenCalled();
    expect(saveSoapNote).not.toHaveBeenCalled();
    expect(finalizeConsultation).not.toHaveBeenCalled();
    expect(onFinishConsultation).not.toHaveBeenCalled();
  });

  it('"Finalizar Consulta" records the payment, saves, and THEN finalizes', async () => {
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finishWithCharge(user);

    await waitFor(() => expect(onFinishConsultation).toHaveBeenCalledWith("appt-1"));
    expect(recordPayment).toHaveBeenCalledWith({
      appointmentId: "appt-1",
      status: "paid",
      amount: 800,
      method: "cash",
      note: "",
    });
    expect(finalizeConsultation).toHaveBeenCalledTimes(1);
    expect(finalizeConsultation).toHaveBeenCalledWith("appt-1");
    const paid = vi.mocked(recordPayment).mock.invocationCallOrder[0];
    const saved = vi.mocked(saveSoapNote).mock.invocationCallOrder[0];
    const finalized = vi.mocked(finalizeConsultation).mock.invocationCallOrder[0];
    expect(paid).toBeLessThan(saved);
    expect(saved).toBeLessThan(finalized);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a failed payment does not save or finalize, and keeps the charge step open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    vi.mocked(recordPayment).mockRejectedValue(new Error("No se pudo guardar el cobro."));
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finishWithCharge(user);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No se pudo guardar el cobro."));
    expect(saveSoapNote).not.toHaveBeenCalled();
    expect(finalizeConsultation).not.toHaveBeenCalled();
    expect(onFinishConsultation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(chargeDialogTitle()).toBeInTheDocument();
  });

  it("closes after finalizing when no finish handler is given", async () => {
    const { onClose, user } = renderWorkspace({ onFinishConsultation: undefined });
    await waitForHistory();

    await finishWithCharge(user, "cortesia");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(finalizeConsultation).toHaveBeenCalledTimes(1);
  });

  it("does not finalize when saving the note fails, and shows the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    vi.mocked(saveSoapNote).mockRejectedValue(new Error("Esta consulta ya fue finalizada."));
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await finishWithCharge(user);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Esta consulta ya fue finalizada."),
    );
    expect(finalizeConsultation).not.toHaveBeenCalled();
    expect(onFinishConsultation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The doctor can try again.
    expect(screen.getByRole("button", { name: /Finalizar Consulta/ })).toBeEnabled();
  });

  it("in review mode (no appointment) neither saves notes nor finalizes", async () => {
    const patient: DashboardPatient = {
      id: "patient-1",
      name: "Ana Pérez",
      phone: "+525512345678",
      status: "active",
      totalVisits: 3,
      lastVisit: null,
      notes: "",
    };
    const { onClose, user } = renderWorkspace({ appointment: undefined, patient });
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: "Cerrar Expediente" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveSoapNote).not.toHaveBeenCalled();
    expect(finalizeConsultation).not.toHaveBeenCalled();
    expect(recordPayment).not.toHaveBeenCalled();
    expect(chargeDialogTitle()).toBeNull();
  });
});
