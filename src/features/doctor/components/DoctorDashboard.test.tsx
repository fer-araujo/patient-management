import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import type { ReactNode } from "react";
import {
  fetchDoctorAppointments,
  updateAppointmentStatus,
  type DashboardAppointment,
} from "../../../lib/services/clinicService";
import { fetchBlockedSlots } from "../../../lib/services/blockedSlotsService";
import { fetchArcoRequests } from "../../../lib/services/privacyService";
import { DoctorDashboard } from "./DoctorDashboard";

vi.mock("../../../lib/services/clinicService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/services/clinicService")>()),
  fetchDoctorAppointments: vi.fn(),
  updateAppointmentStatus: vi.fn(),
}));
vi.mock("../../../lib/services/blockedSlotsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/services/blockedSlotsService")>()),
  fetchBlockedSlots: vi.fn(),
}));
vi.mock("../../../lib/services/privacyService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/services/privacyService")>()),
  fetchArcoRequests: vi.fn(),
}));

// Only the dashboard's hand-off is under test: the children are stubs.
vi.mock("../context/CalendarProvider", () => ({
  CalendarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./ClinicModeSwitch", () => ({ ClinicModeSwitch: () => null }));
vi.mock("../prescription/PrescriberProfileButton", () => ({
  PrescriberProfileButton: () => null,
}));
vi.mock("./tabs/InboxTab", () => ({
  InboxTab: ({ appointments }: { appointments: DashboardAppointment[] }) => (
    <p>{`Agenda: ${appointments.length}`}</p>
  ),
}));
vi.mock("./tabs/CalendarTab", () => ({
  CalendarTab: ({
    appointments,
    onStartConsultation,
  }: {
    appointments: DashboardAppointment[];
    onStartConsultation: (a: DashboardAppointment) => void;
  }) => (
    <button type="button" onClick={() => onStartConsultation(appointments[0])}>
      Iniciar consulta
    </button>
  ),
}));
vi.mock("./ConsultationWorkspace", () => ({
  ConsultationWorkspace: ({
    appointment,
    onClose,
    onFinishConsultation,
  }: {
    appointment: DashboardAppointment;
    onClose: () => void;
    onFinishConsultation: (id: string, options?: { keepOpen: boolean }) => Promise<void>;
  }) => (
    <div>
      <p>{`Consulta de ${appointment.patientName}`}</p>
      <button type="button" onClick={() => onFinishConsultation(appointment.id)}>
        Finalizar sin receta
      </button>
      <button
        type="button"
        onClick={() => onFinishConsultation(appointment.id, { keepOpen: true })}
      >
        Finalizar con receta
      </button>
      <button type="button" onClick={onClose}>
        Listo
      </button>
    </div>
  ),
}));

const appointment: DashboardAppointment = {
  id: "appt-1",
  patientId: "patient-1",
  patientName: "Ana Pérez",
  service: "Valoración",
  date: "15 oct 2026",
  time: "10:30 AM",
  phone: "+525512345678",
  isNewPatient: false,
  status: "confirmed",
  durationMins: 30,
  reason: null,
  servicePrice: 800,
};

beforeEach(() => {
  vi.mocked(fetchDoctorAppointments).mockResolvedValue([appointment]);
  vi.mocked(fetchBlockedSlots).mockResolvedValue([]);
  vi.mocked(fetchArcoRequests).mockResolvedValue([]);
  vi.mocked(updateAppointmentStatus).mockResolvedValue();
});

const startConsultation = async () => {
  const user = userEvent.setup();
  render(<DoctorDashboard />);
  await user.click(await screen.findByRole("button", { name: /Calendario/ }));
  await user.click(screen.getByRole("button", { name: "Iniciar consulta" }));
  await screen.findByText("Consulta de Ana Pérez");
  return user;
};

describe("DoctorDashboard finishing a consultation", () => {
  it("with a prescription, marks it completed once and keeps the workspace until Listo", async () => {
    const toastSuccess = vi.spyOn(toast, "success");
    const user = await startConsultation();

    await user.click(screen.getByRole("button", { name: "Finalizar con receta" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("¡Expediente guardado y cita finalizada!"),
    );
    expect(updateAppointmentStatus).toHaveBeenCalledTimes(1);
    expect(updateAppointmentStatus).toHaveBeenCalledWith("appt-1", "completed");
    // Initial load + the refresh after finishing.
    expect(fetchDoctorAppointments).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Consulta de Ana Pérez")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Listo" }));

    expect(await screen.findByRole("button", { name: "Iniciar consulta" })).toBeInTheDocument();
    expect(screen.queryByText("Consulta de Ana Pérez")).toBeNull();
    expect(updateAppointmentStatus).toHaveBeenCalledTimes(1);
  });

  it("without a prescription, closes the workspace right after marking it completed", async () => {
    const user = await startConsultation();

    await user.click(screen.getByRole("button", { name: "Finalizar sin receta" }));

    expect(await screen.findByRole("button", { name: "Iniciar consulta" })).toBeInTheDocument();
    expect(screen.queryByText("Consulta de Ana Pérez")).toBeNull();
    expect(updateAppointmentStatus).toHaveBeenCalledTimes(1);
    expect(updateAppointmentStatus).toHaveBeenCalledWith("appt-1", "completed");
  });
});
