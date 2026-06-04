import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

import { BookingFlow } from "./features/appointments/components/BookingFlow";
import { PatientDashboard } from "./features/patients/components/PatientDashboard";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { DashboardBooking } from "./features/appointments/components/DashboardBooking";
import { RescheduleFlow } from "./features/appointments/components/RescheduleFlow";

// IMPORTS DE LA DOCTORA
import { DoctorDashboard } from "./features/doctor/components/DoctorDashboard";
import { AdminLogin } from "./features/auth/components/AdminLogin";

// =========================================
// 0. COMPONENTE GUARDIÁN (Ruta Protegida)
// =========================================
function DoctorProtectedRoute({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Revisamos la sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Escuchamos cambios (cuando inicia o cierra sesión)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-brand-primary font-bold">
        Verificando acceso médico...
      </div>
    );
  }

  // Si no hay sesión de administrador, mostramos el Login.
  // (La función onLoginSuccess no hace nada aquí porque el onAuthStateChange de arriba detecta el login automáticamente)
  if (!session) {
    return <AdminLogin onLoginSuccess={() => {}} />;
  }

  // Si hay sesión, renderizamos los hijos (El Dashboard)
  return <>{children}</>;
}

// 1. Extraemos las rutas a un componente interno
function AppRoutes() {
  const navigate = useNavigate();

  return (
    <Routes>
      {/* =========================================
          RUTAS PÚBLICAS Y DE PACIENTES
          (Estas siguen funcionando igual que antes)
          ========================================= */}
      <Route
        path="/"
        element={<BookingFlow onComplete={() => navigate("/dashboard")} />}
      />

      <Route
        path="/dashboard"
        element={
          <DashboardLayout>
            <PatientDashboard />
          </DashboardLayout>
        }
      />
      <Route
        path="/dashboard/agendar"
        element={
          <DashboardLayout>
            <DashboardBooking />
          </DashboardLayout>
        }
      />
      <Route
        path="/dashboard/reprogramar"
        element={
          <DashboardLayout>
            <RescheduleFlow />
          </DashboardLayout>
        }
      />

      {/* =========================================
          RUTAS DE LA DOCTORA (AHORA PROTEGIDAS)
          ========================================= */}
      <Route
        path="/doctor/dashboard"
        element={
          /* Envolvemos el Dashboard con el Guardián */
          <DoctorProtectedRoute>
            <DashboardLayout>
              <DoctorDashboard />
            </DashboardLayout>
          </DoctorProtectedRoute>
        }
      />
    </Routes>
  );
}

// 2. App envuelve todo en el BrowserRouter
function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;