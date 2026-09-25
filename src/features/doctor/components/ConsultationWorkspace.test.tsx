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

beforeEach(() => {
  vi.mocked(fetchPatientHistory).mockResolvedValue({ notes: [], prescriptions: [] });
  vi.mocked(getPatientFiles).mockResolvedValue([]);
  vi.mocked(saveSoapNote).mockResolvedValue();
  vi.mocked(savePrescription).mockResolvedValue();
  vi.mocked(updatePatientNotes).mockResolvedValue();
  vi.mocked(finalizeConsultation).mockResolvedValue();
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

  it('"Finalizar Consulta" saves and THEN finalizes the consultation', async () => {
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));

    await waitFor(() => expect(onFinishConsultation).toHaveBeenCalledWith("appt-1"));
    expect(finalizeConsultation).toHaveBeenCalledTimes(1);
    expect(finalizeConsultation).toHaveBeenCalledWith("appt-1");
    expect(vi.mocked(saveSoapNote).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(finalizeConsultation).mock.invocationCallOrder[0],
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after finalizing when no finish handler is given", async () => {
    const { onClose, user } = renderWorkspace({ onFinishConsultation: undefined });
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(finalizeConsultation).toHaveBeenCalledTimes(1);
  });

  it("does not finalize when saving the note fails, and shows the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    vi.mocked(saveSoapNote).mockRejectedValue(new Error("Esta consulta ya fue finalizada."));
    const { onClose, onFinishConsultation, user } = renderWorkspace();
    await waitForHistory();

    await user.click(screen.getByRole("button", { name: /Finalizar Consulta/ }));

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
  });
});
