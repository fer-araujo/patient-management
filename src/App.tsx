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
type StaffArea = "clinical" | "business";

function DoctorProtectedRoute({
  area,
  children,
}: {
  area: StaffArea;
  children: React.ReactNode;
}) {
  const { session, role, loading } = useAuthRole();
  const isStaff = isStaffRole(role);
  const isAllowed = area === "clinical" ? isDoctorRole(role) : isBusinessRole(role);
  const isDeniedStaffArea = !loading && !!session && !isStaff;
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

  // Signed in, but not staff.
  if (!isStaff) return <Navigate to="/dashboard" replace />;

  // Staff, but not for this area (an admin in Centro Clínico).
  if (!isAllowed) return <Navigate to="/doctor/admin" replace />;

  return <>{children}</>;
}

// =========================================
// 0B. GUARDIÁN DEL PORTAL DEL PACIENTE
// =========================================
function PatientProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthRole();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary" />
      </div>
    );
  }

  // Si alguien escribe /dashboard en la URL y NO tiene token, lo pateamos a la página principal.
  if (!session) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// =========================================
// 1. RUTAS
// =========================================
function AppRoutes() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        path="/"
        element={<BookingFlow onComplete={() => navigate("/dashboard")} />}
      />

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

function App() {
  return (
    <BrowserRouter>
      <Toast />
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
