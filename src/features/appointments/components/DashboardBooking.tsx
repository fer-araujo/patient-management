import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { ServiceSelector } from "./ServiceSelector";
import { DateTimeSelector } from "./DateTimeSelector";
import { BookingSuccess } from "./BookingSuccess";

export const DashboardBooking = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Si venimos del carrusel, empezamos en el paso 2
  const initialService = location.state?.preselectedService || "";
  const initialStep = initialService ? 2 : 1;

  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [bookingData, setBookingData] = useState({
    serviceId: initialService,
    date: "",
    time: "",
  });

  const handleServiceSelect = (serviceId: string) => {
    setBookingData((prev) => ({ ...prev, serviceId }));
    setStep(2);
  };

  const handleDateTimeSubmit = (date: string, time: string) => {
    setBookingData((prev) => ({ ...prev, date, time }));
    console.log("Nueva cita agendada desde Dashboard:", {
      ...bookingData,
      date,
      time,
    });
    setStep(3); // Vamos al Success
  };

  // =================================================================
  // EL FIX MAGISTRAL: "Agendar otra cita"
  // =================================================================
  const handleBookAnother = () => {
    // 1. Limpiamos los datos
    setBookingData({ serviceId: "", date: "", time: "" });
    // 2. Volvemos al paso 1
    setStep(1);
    // 3. Limpiamos la memoria del router (por si venía del carrusel)
    navigate(location.pathname, { replace: true, state: {} });
  };

  return (
    <div className="max-w-4xl mx-auto pt-8 xl:pt-10 px-4 sm:px-6">
      <div className="bg-white rounded-[3rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-6 sm:p-12 overflow-hidden relative min-h-150 flex flex-col justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(var(--color-brand-primary)_1px,transparent_1px)] bg-size-[32px_32px] opacity-[0.02] pointer-events-none"></div>

        <div className="relative z-10 flex justify-center w-full">
          <AnimatePresence mode="wait">
            {/* PASO 1: Elegir Servicio */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full flex justify-center"
              >
                <ServiceSelector
                  isDirectMode={true} // <-- Usamos el modo directo para que el botón diga "Volver al Dashboard"
                  onBack={() => navigate("/dashboard")}
                  onSelect={handleServiceSelect}
                />
              </motion.div>
            )}

            {/* PASO 2: Elegir Fecha y Hora */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full flex justify-center"
              >
                <DateTimeSelector
                  isDirectMode={initialStep === 2} // Solo dice "Volver al Dashboard" si saltamos directo al paso 2
                  onBack={() => {
                    if (initialStep === 2) {
                      navigate("/dashboard");
                    } else {
                      setStep(1);
                    }
                  }}
                  onSubmit={handleDateTimeSubmit}
                />
              </motion.div>
            )}

            {/* PASO 3: Éxito */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full flex justify-center"
              >
                <BookingSuccess
                  bookingData={bookingData}
                  isReschedule={false} // Es cita nueva
                  onGoToDashboard={() => navigate("/dashboard")}
                  onGoHome={handleBookAnother} // <--- AQUI CONECTAMOS NUESTRA FUNCIÓN
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
