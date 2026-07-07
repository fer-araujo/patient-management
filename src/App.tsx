import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useNavigate,
  Navigate,
} from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

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
// 0A. COMPONENTE GUARDIÁN (LA DOCTORA)
// =========================================
function DoctorProtectedRoute({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-brand-primary font-bold">
        Verificando acceso médico...
      </div>
    );
  if (!session) return <AdminLogin onLoginSuccess={() => {}} />;

  return <>{children}</>;
}

// =========================================
// 0B. 🛡️ NUEVO COMPONENTE GUARDIÁN (PACIENTES) 🛡️
// =========================================
function PatientProtectedRoute({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // No necesitamos suscripción reactiva aquí porque si cierran sesión los pateamos manualmente,
    // pero verificamos al instante de montar el componente.
  }, []);

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
          <DoctorProtectedRoute>
            <DashboardLayout>
              <DoctorDashboard />
            </DashboardLayout>
          </DoctorProtectedRoute>
        }
      />

      <Route
        path="/doctor/admin"
        element={
          <DoctorProtectedRoute>
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
