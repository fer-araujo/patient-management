import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { DateTimeSelector } from "./DateTimeSelector";
import { BookingSuccess } from "./BookingSuccess";

export const RescheduleFlow = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);

  // Simulamos los datos de la cita ACTUAL que el paciente quiere cambiar
  // En producción, esto vendría de tu backend (ej. un useParams con el ID de la cita)
  const [bookingData, setBookingData] = useState({
    serviceId: "regenerativa", // Para que BookingSuccess sepa qué servicio es
    date: "2026-03-16", // Fecha actual pre-seleccionada
    time: "11:30 AM", // Hora actual pre-seleccionada
  });

  const handleDateTimeSubmit = (newDate: string, newTime: string) => {
    setBookingData((prev) => ({ ...prev, date: newDate, time: newTime }));
    console.log("Cita REPROGRAMADA a:", {
      ...bookingData,
      date: newDate,
      time: newTime,
    });
    setStep(2);
  };

  return (
    <div className="max-w-4xl mx-auto pt-8 xl:pt-10 px-4 sm:px-6">
      <div className="bg-white rounded-[3rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-6 sm:p-12 overflow-hidden relative min-h-150 flex flex-col justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(var(--color-brand-primary)_1px,transparent_1px)] bg-size-[32px_32px] opacity-[0.02] pointer-events-none"></div>

        <div className="relative z-10 flex justify-center w-full">
          <AnimatePresence mode="wait">
            {/* PASO 1: Selector pre-llenado */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full flex justify-center"
              >
                <DateTimeSelector
                  initialDate={bookingData.date}
                  initialTime={bookingData.time}
                  isDirectMode={true} // <-- MAGIA 1: Muestra el botón de "Volver" en vez del paso 2 de 2
                  onBack={() => navigate("/dashboard")}
                  onSubmit={handleDateTimeSubmit}
                />
              </motion.div>
            )}

            {/* PASO 2: Éxito Reprogramado */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full flex justify-center"
              >
                <BookingSuccess
                  bookingData={bookingData}
                  isReschedule={true} // <-- MAGIA 2: Cambia textos y oculta el botón secundario
                  onGoToDashboard={() => navigate("/dashboard")}
                  // onGoHome ya no es necesario aquí gracias al isReschedule
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
