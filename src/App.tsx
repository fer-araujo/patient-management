import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useNavigate,
  Navigate,
} from "react-router-dom";
import toast from "react-hot-toast";
import {
  useAuthRole,
  isStaffRole,
  isDoctorRole,
  isBusinessRole,
} from "./features/auth/useAuthRole";

import { BookingFlow } from "./features/appointments/components/BookingFlow";
import { PatientDashboard } from "./features/patients/components/PatientDashboard";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { DashboardBooking } from "./features/appointments/components/DashboardBooking";
import { RescheduleFlow } from "./features/appointments/components/RescheduleFlow";

import { DoctorDashboard } from "./features/doctor/components/DoctorDashboard";
import { AdminLogin } from "./features/auth/components/AdminLogin";
import { Toast } from "./components/ui/Toast";
import { Loader2 } from "lucide-react";
import { DoctorAdminDashboard } from "./features/doctor/components/DoctorAdminDashboard";
import { NoAccessScreen } from "./features/auth/components/NoAccessScreen";
import { RoleErrorScreen } from "./features/auth/components/RoleErrorScreen";
import { ClinicModeProvider } from "./features/clinicMode/ClinicModeProvider";
import { useClinicMode } from "./features/clinicMode/useClinicMode";

// =========================================
// 0A. GUARDIÁN DEL ÁREA MÉDICA
// =========================================
// Access is decided by the profiles.role of the current session, never by the
// URL. A phone-OTP patient session is authenticated but is NOT staff, so it is
// bounced out of /doctor/* instead of rendering the clinical dashboards.
//
// `area` picks who may enter:
//   clinical -> Centro Clínico, the doctor only. An admin is sent to
//               Administración, the only area it may open.
//   business -> Administración, the doctor or an admin.
//
// In doctor-only mode there is no patient portal, so a non-staff session gets
// a short "no access" screen with a sign-out button instead.
type StaffArea = "clinical" | "business";

function DoctorProtectedRoute({
  area,
  children,
}: {
  area: StaffArea;
  children: React.ReactNode;
}) {
  const { session, role, loading: roleLoading, roleError, retryRole } = useAuthRole();
  const { doctorOnlyMode, loading: modeLoading } = useClinicMode();
  const isStaff = isStaffRole(role);
  // Staff never depend on the clinic mode to enter: a mode re-read (the
  // switch's "Reintentar") or a stalled read must not unmount the dashboard.
  // Only a non-staff session needs the mode, to pick its no-access screen.
  const loading = roleLoading || (!isStaff && modeLoading);
  const isAllowed = area === "clinical" ? isDoctorRole(role) : isBusinessRole(role);
  // A failed role read is not a denial: no "no access" toast for it.
  const isDeniedStaffArea = !loading && !!session && !roleError && !isStaff;
  const isAdminInClinicalArea = !loading && !!session && isStaff && !isAllowed;

  useEffect(() => {
    if (isDeniedStaffArea) {
      toast.error("Tu cuenta no tiene acceso al área médica.");
    }
  }, [isDeniedStaffArea]);

  useEffect(() => {
    if (isAdminInClinicalArea) {
      toast.error("Tu cuenta solo tiene acceso a Administración.");
    }
  }, [isAdminInClinicalArea]);

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-brand-primary font-bold">
        Verificando acceso médico...
      </div>
    );

  // No session at all: show the staff login, same as before.
  if (!session) return <AdminLogin onLoginSuccess={() => {}} />;

  // Signed in, but the role could not be read: let her try again.
  if (roleError) return <RoleErrorScreen onRetry={retryRole} />;

  // Signed in, but not staff.
  if (!isStaff) {
    return doctorOnlyMode ? <NoAccessScreen /> : <Navigate to="/dashboard" replace />;
  }

  // Staff, but not for this area (an admin in Centro Clínico).
  if (!isAllowed) return <Navigate to="/doctor/admin" replace />;

  return <>{children}</>;
}

// =========================================
// 0B. GUARDIÁN DEL PORTAL DEL PACIENTE
// =========================================
function PatientProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading: roleLoading } = useAuthRole();
  const { doctorOnlyMode, loading: modeLoading } = useClinicMode();
  const loading = roleLoading || modeLoading;

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary" />
      </div>
    );
  }

  // Doctor-only mode: there is no patient portal at all.
  if (doctorOnlyMode) {
    return <Navigate to="/" replace />;
  }

  // Si alguien escribe /dashboard en la URL y NO tiene token, lo pateamos a la página principal.
  if (!session) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// =========================================
// 0C. PÁGINA DE INICIO
// =========================================
// Normal mode: the public booking flow. Doctor-only mode: the clinic's sign-in
// (patients have nothing to open), and a staff session goes straight to its
// dashboard.
function HomeRoute() {
  const navigate = useNavigate();
  const { doctorOnlyMode, loading } = useClinicMode();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary" />
      </div>
    );
  }

  if (doctorOnlyMode) return <ClinicEntry />;

  return <BookingFlow onComplete={() => navigate("/dashboard")} />;
}

function ClinicEntry() {
  const { session, role, loading, roleError, retryRole } = useAuthRole();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary" />
      </div>
    );
  }

  // Signing in re-renders this route with the new session (useAuthRole).
  if (!session) return <AdminLogin onLoginSuccess={() => {}} />;

  if (roleError) return <RoleErrorScreen onRetry={retryRole} />;

  if (!isStaffRole(role)) return <NoAccessScreen />;

  return (
    <Navigate to={isDoctorRole(role) ? "/doctor/dashboard" : "/doctor/admin"} replace />
  );
}

// =========================================
// 1. RUTAS
// =========================================
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />

      {/* TODAS LAS RUTAS DEL PACIENTE ESTÁN AHORA DENTRO DE SU GUARDIÁN */}
      <Route
        path="/dashboard"
        element={
          <PatientProtectedRoute>
            <DashboardLayout>
              <PatientDashboard />
            </DashboardLayout>
          </PatientProtectedRoute>
        }
      />

      <Route
        path="/dashboard/agendar"
        element={
          <PatientProtectedRoute>
            <DashboardLayout>
              <DashboardBooking />
            </DashboardLayout>
          </PatientProtectedRoute>
        }
      />

      <Route
        path="/dashboard/reprogramar"
        element={
          <PatientProtectedRoute>
            <DashboardLayout>
              <RescheduleFlow />
            </DashboardLayout>
          </PatientProtectedRoute>
        }
      />

      {/* RUTAS DE LA DOCTORA */}
      <Route
        path="/doctor/dashboard"
        element={
          <DoctorProtectedRoute area="clinical">
            <DashboardLayout>
              <DoctorDashboard />
            </DashboardLayout>
          </DoctorProtectedRoute>
        }
      />

      <Route
        path="/doctor/admin"
        element={
          <DoctorProtectedRoute area="business">
            <DashboardLayout>
              <DoctorAdminDashboard />
            </DashboardLayout>
          </DoctorProtectedRoute>
        }
      />
    </Routes>
  );
}

function App({
  clinicModeRetryDelayMs,
}: {
  /** Pause before each retry of the clinic-mode read; tests pass 0. */
  clinicModeRetryDelayMs?: number;
} = {}) {
  return (
    <BrowserRouter>
      <ClinicModeProvider retryDelayMs={clinicModeRetryDelayMs}>
        <Toast />
        <AppRoutes />
      </ClinicModeProvider>
    </BrowserRouter>
  );
}

export default App;
