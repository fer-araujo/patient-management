import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { makeSession, supabaseMock } from "./test/supabaseMock";
import App from "./App";

// The screens behind the guards are heavy (3D, data loading). The guards are
// what is under test, so each screen is replaced by a labelled placeholder.
// The doctor dashboard placeholder keeps the real mode switch (its
// "Reintentar" re-reads the mode) and counts mounts, to prove a re-read never
// unmounts the screen the doctor is working in.
const dashboardMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./features/doctor/components/DoctorDashboard", async () => {
  const { useEffect } = await import("react");
  const { ClinicModeSwitch } = await import(
    "./features/doctor/components/ClinicModeSwitch"
  );
  return {
    DoctorDashboard: () => {
      useEffect(() => {
        dashboardMounts.count += 1;
      }, []);
      return (
        <>
          <h1>Doctor dashboard</h1>
          <ClinicModeSwitch />
        </>
      );
    },
  };
});
vi.mock("./features/doctor/components/DoctorAdminDashboard", () => ({
  DoctorAdminDashboard: () => <h1>Doctor admin dashboard</h1>,
}));
vi.mock("./features/patients/components/PatientDashboard", () => ({
  PatientDashboard: () => <h1>Patient dashboard</h1>,
}));
// Counts renders, to prove the public booking never flashes before the mode is known.
const bookingRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("./features/appointments/components/BookingFlow", () => ({
  BookingFlow: () => {
    bookingRenders.count += 1;
    return <h1>Public booking</h1>;
  },
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
  // No real pause between clinic-mode retries in tests.
  return render(<App clinicModeRetryDelayMs={0} />);
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

  it("treats a session without a profile row as NOT staff", async () => {
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

  it("offers a retry, not a denial, when the role cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    supabaseMock.setSession(makeSession("doctor-user"));
    supabaseMock.onFrom(
      "profiles",
      { error: { message: "network down" } },
      { data: { role: "doctor" } },
    );

    renderAt("/doctor/dashboard");

    expect(await screen.findByText("No se pudo verificar tu cuenta")).toBeInTheDocument();
    expect(screen.queryByText("Patient dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Esta cuenta no tiene acceso")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/doctor/dashboard");
    expect(toastError).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: /Reintentar/ }));

    expect(await screen.findByText("Doctor dashboard")).toBeInTheDocument();
  });

  it("offers the patient portal way back from the staff sign-in when the mode is off", async () => {
    supabaseMock.onRpc("get_clinic_mode", { data: false });

    renderAt("/doctor/dashboard");

    expect(await screen.findByLabelText("Correo corporativo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Volver al portal de pacientes/ }),
    ).toBeInTheDocument();
  });

  it("shows a neutral loading state while the role is being checked", () => {
    renderAt("/doctor/dashboard");
    expect(screen.getByText("Verificando acceso médico...")).toBeInTheDocument();
  });
});

describe("staff route matrix", () => {
  type Who = "none" | "patient" | "admin" | "doctor";
  const CLINICAL = "/doctor/dashboard";
  const BUSINESS = "/doctor/admin";

  it.each<[Who, string, string, string]>([
    // who,       route,    expected screen,           expected path
    ["none",    CLINICAL, "Correo corporativo",      CLINICAL],
    ["none",    BUSINESS, "Correo corporativo",      BUSINESS],
    ["patient", CLINICAL, "Patient dashboard",       "/dashboard"],
    ["patient", BUSINESS, "Patient dashboard",       "/dashboard"],
    ["admin",   CLINICAL, "Doctor admin dashboard",  BUSINESS],
    ["admin",   BUSINESS, "Doctor admin dashboard",  BUSINESS],
    ["doctor",  CLINICAL, "Doctor dashboard",        CLINICAL],
    ["doctor",  BUSINESS, "Doctor admin dashboard",  BUSINESS],
  ])("%s at %s lands on %s (%s)", async (who, route, screenText, path) => {
    if (who !== "none") signInAs(`${who}-user`, who);

    renderAt(route);

    if (who === "none") {
      expect(await screen.findByLabelText(screenText)).toBeInTheDocument();
    } else {
      expect(await screen.findByText(screenText)).toBeInTheDocument();
    }
    await waitFor(() => expect(window.location.pathname).toBe(path));
  });

  it("never renders Centro Clínico for an admin and explains the redirect", async () => {
    const toastError = vi.spyOn(toast, "error");
    signInAs("admin-user", "admin");

    renderAt(CLINICAL);

    expect(await screen.findByText("Doctor admin dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Doctor dashboard")).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Tu cuenta solo tiene acceso a Administración.");
    expect(toastError).not.toHaveBeenCalledWith("Tu cuenta no tiene acceso al área médica.");
  });

  it("does not toast for a doctor in either area", async () => {
    const toastError = vi.spyOn(toast, "error");
    signInAs("doctor-user", "doctor");

    renderAt(BUSINESS);

    expect(await screen.findByText("Doctor admin dashboard")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("PatientProtectedRoute", () => {
  it("sends a visitor without a session back to the public booking page", async () => {
    renderAt("/dashboard");

    expect(await screen.findByText("Public booking")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});

describe("doctor-only mode (Modo solo doctora)", () => {
  const modeOn = () => supabaseMock.onRpc("get_clinic_mode", { data: true });

  it("shows the clinic sign-in at / instead of the public booking", async () => {
    modeOn();

    renderAt("/");

    expect(await screen.findByLabelText("Correo corporativo")).toBeInTheDocument();
    expect(screen.queryByText("Public booking")).not.toBeInTheDocument();
    // "/" IS the sign-in now: no way back to a patient portal.
    expect(screen.queryByText(/Volver al portal de pacientes/)).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("keeps the public booking at / when the mode is off, with the way back from the sign-in", async () => {
    supabaseMock.onRpc("get_clinic_mode", { data: false });

    renderAt("/");
    expect(await screen.findByText("Public booking")).toBeInTheDocument();
    expect(supabaseMock.rpcCalls("get_clinic_mode")).toHaveLength(1);
  });

  it("falls back to the normal site when the mode cannot be read (after two retries)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("get_clinic_mode", { error: { message: "boom", code: "500" } });

    renderAt("/");

    expect(await screen.findByText("Public booking")).toBeInTheDocument();
    expect(supabaseMock.rpcCalls("get_clinic_mode")).toHaveLength(3);
  });

  it("keeps the patient portal open when the mode cannot be read (the database still refuses if it is on)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("get_clinic_mode", { error: { message: "boom", code: "500" } });
    signInAs("patient-user", "patient");

    renderAt("/dashboard");

    expect(await screen.findByText("Patient dashboard")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("never flashes the public booking while the mode is still being read", async () => {
    bookingRenders.count = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    supabaseMock.onRpc("get_clinic_mode", () => held.then(() => ({ data: true })));

    renderAt("/");

    // Give the app several turns: the read is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Public booking")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Correo corporativo")).not.toBeInTheDocument();

    release();

    expect(await screen.findByLabelText("Correo corporativo")).toBeInTheDocument();
    expect(bookingRenders.count).toBe(0);
  });

  it("offers a retry at / when a signed-in account's role cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    modeOn();
    supabaseMock.setSession(makeSession("doctor-user"));
    supabaseMock.onFrom("profiles", { error: { message: "network down" } });

    renderAt("/");

    expect(await screen.findByText("No se pudo verificar tu cuenta")).toBeInTheDocument();
    expect(screen.queryByText("Esta cuenta no tiene acceso")).not.toBeInTheDocument();
  });

  it.each<["doctor" | "admin", string, string]>([
    ["doctor", "Doctor dashboard", "/doctor/dashboard"],
    ["admin", "Doctor admin dashboard", "/doctor/admin"],
  ])("sends a signed-in %s from / to their dashboard", async (role, screenText, path) => {
    modeOn();
    signInAs(`${role}-user`, role);

    renderAt("/");

    expect(await screen.findByText(screenText)).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(path));
  });

  it.each(["/dashboard", "/dashboard/agendar", "/dashboard/reprogramar"])(
    "closes the patient portal: %s goes back to /",
    async (path) => {
      modeOn();
      signInAs("patient-user", "patient");

      renderAt(path);

      expect(await screen.findByText("Esta cuenta no tiene acceso")).toBeInTheDocument();
      expect(screen.queryByText("Patient dashboard")).not.toBeInTheDocument();
      expect(screen.queryByText("Patient booking")).not.toBeInTheDocument();
      expect(screen.queryByText("Reschedule")).not.toBeInTheDocument();
      await waitFor(() => expect(window.location.pathname).toBe("/"));
    },
  );

  it("does not send a patient session in the medical area to the portal; it can only sign out", async () => {
    modeOn();
    signInAs("patient-user", "patient");

    renderAt("/doctor/dashboard");

    expect(await screen.findByText("Esta cuenta no tiene acceso")).toBeInTheDocument();
    expect(screen.queryByText("Patient dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Doctor dashboard")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/doctor/dashboard");

    await userEvent.setup().click(screen.getByRole("button", { name: /Cerrar sesión/ }));
    expect(supabaseMock.client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("keeps the doctor dashboard mounted while the switch's Reintentar re-reads the mode", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dashboardMounts.count = 0;
    signInAs("doctor-user", "doctor");
    // The first read (and its two retries) fails; the re-read then hangs.
    let calls = 0;
    supabaseMock.onRpc("get_clinic_mode", () => {
      calls += 1;
      return calls <= 3
        ? { error: { message: "boom", code: "500" } }
        : new Promise(() => {});
    });

    renderAt("/doctor/dashboard");

    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    expect(screen.getByText("Doctor dashboard")).toBeInTheDocument();
    expect(dashboardMounts.count).toBe(1);

    await userEvent.setup().click(retry);

    await waitFor(() => expect(calls).toBe(4));
    // The re-read is in flight: no "checking access" screen, same dashboard.
    expect(screen.queryByText("Verificando acceso médico...")).not.toBeInTheDocument();
    expect(screen.getByText("Doctor dashboard")).toBeInTheDocument();
    expect(dashboardMounts.count).toBe(1);
  });

  it("does not hold the doctor on the loading screen while the mode is still being read", async () => {
    signInAs("doctor-user", "doctor");
    supabaseMock.onRpc("get_clinic_mode", () => new Promise(() => {}));

    renderAt("/doctor/dashboard");

    expect(await screen.findByText("Doctor dashboard")).toBeInTheDocument();
  });

  it("still renders the doctor dashboard for the doctor", async () => {
    modeOn();
    signInAs("doctor-user", "doctor");

    renderAt("/doctor/dashboard");

    expect(await screen.findByText("Doctor dashboard")).toBeInTheDocument();
  });
});
