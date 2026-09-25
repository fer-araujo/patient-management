import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { makeSession, supabaseMock } from "./test/supabaseMock";
import App from "./App";

// The screens behind the guards are heavy (3D, data loading). The guards are
// what is under test, so each screen is replaced by a labelled placeholder.
vi.mock("./features/doctor/components/DoctorDashboard", () => ({
  DoctorDashboard: () => <h1>Doctor dashboard</h1>,
}));
vi.mock("./features/doctor/components/DoctorAdminDashboard", () => ({
  DoctorAdminDashboard: () => <h1>Doctor admin dashboard</h1>,
}));
vi.mock("./features/patients/components/PatientDashboard", () => ({
  PatientDashboard: () => <h1>Patient dashboard</h1>,
}));
vi.mock("./features/appointments/components/BookingFlow", () => ({
  BookingFlow: () => <h1>Public booking</h1>,
}));
vi.mock("./features/appointments/components/DashboardBooking", () => ({
  DashboardBooking: () => <h1>Patient booking</h1>,
}));
vi.mock("./features/appointments/components/RescheduleFlow", () => ({
  RescheduleFlow: () => <h1>Reschedule</h1>,
}));
vi.mock("./components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

const signInAs = (userId: string, role: "doctor" | "admin" | "patient") => {
  supabaseMock.setSession(makeSession(userId));
  supabaseMock.onFrom("profiles", { data: { role } });
};

describe("DoctorProtectedRoute", () => {
  it("shows the staff login when there is no session", async () => {
    renderAt("/doctor/dashboard");

    expect(await screen.findByLabelText("Correo corporativo")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.queryByText("Doctor dashboard")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/doctor/dashboard");
  });

  it("bounces a signed-in patient out of the medical area", async () => {
    const toastError = vi.spyOn(toast, "error");
    signInAs("patient-user", "patient");

    renderAt("/doctor/dashboard");

    expect(await screen.findByText("Patient dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Doctor dashboard")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard");
    expect(toastError).toHaveBeenCalledWith("Tu cuenta no tiene acceso al área médica.");
  });

  it("bounces a patient from the admin area too", async () => {
    signInAs("patient-user", "patient");

    renderAt("/doctor/admin");

    expect(await screen.findByText("Patient dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Doctor admin dashboard")).not.toBeInTheDocument();
  });

  it("treats a session whose profile role cannot be read as NOT staff", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.setSession(makeSession("unknown-user"));
    supabaseMock.onFrom("profiles", { data: null });

    renderAt("/doctor/dashboard");

    await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
    expect(screen.queryByText("Doctor dashboard")).not.toBeInTheDocument();
  });

  it("renders the doctor dashboard for a doctor session", async () => {
    signInAs("doctor-user", "doctor");

    renderAt("/doctor/dashboard");

    expect(await screen.findByText("Doctor dashboard")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/doctor/dashboard");
  });

  it("renders the admin dashboard for an admin session", async () => {
    signInAs("admin-user", "admin");

    renderAt("/doctor/admin");

    expect(await screen.findByText("Doctor admin dashboard")).toBeInTheDocument();
  });

  it("shows a neutral loading state while the role is being checked", () => {
    renderAt("/doctor/dashboard");
    expect(screen.getByText("Verificando acceso médico...")).toBeInTheDocument();
  });
});

describe("PatientProtectedRoute", () => {
  it("sends a visitor without a session back to the public booking page", async () => {
    renderAt("/dashboard");

    expect(await screen.findByText("Public booking")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
