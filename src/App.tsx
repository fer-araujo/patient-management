import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { BookingFlow } from "./features/appointments/components/BookingFlow";
import { PatientDashboard } from "./features/patients/components/PatientDashboard";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { DashboardBooking } from "./features/appointments/components/DashboardBooking";
import { RescheduleFlow } from "./features/appointments/components/RescheduleFlow";

// NUEVO IMPORT: El Dashboard de la Doctora
import { DoctorDashboard } from "./features/doctor/components/DoctorDashboard";

// 1. Extraemos las rutas a un componente interno para poder usar useNavigate
function AppRoutes() {
  const navigate = useNavigate();

  return (
    <Routes>
      {/* =========================================
          RUTAS PÚBLICAS
          ========================================= */}
      <Route
        path="/"
        element={<BookingFlow onComplete={() => navigate("/dashboard")} />}
      />

      {/* =========================================
          RUTAS DEL PACIENTE
          ========================================= */}
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
          RUTAS DE LA DOCTORA
          ========================================= */}
      <Route
        path="/doctor/dashboard"
        element={
          <DashboardLayout>
            <DoctorDashboard />
          </DashboardLayout>
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
