import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { BookingFlow } from "./features/appointments/components/BookingFlow";
import { PatientDashboard } from "./features/patients/components/PatientDashboard";
import { DashboardLayout } from "./components/layout/DashboardLayout";

// 1. Extraemos las rutas a un componente interno para poder usar useNavigate
function AppRoutes() {
  const navigate = useNavigate();

  return (
    <Routes>
      {/* La ruta pública (Login) */}
      <Route
        path="/"
        element={<BookingFlow onComplete={() => navigate("/dashboard")} />}
      />

      {/* La ruta privada (Dashboard del paciente) */}
      <Route
        path="/dashboard"
        element={
          <DashboardLayout>
            <PatientDashboard />
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
