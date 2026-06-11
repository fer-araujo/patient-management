import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";

import { DateTimeSelector } from "./DateTimeSelector";
import { BookingSuccess } from "./BookingSuccess";
import { rescheduleAppointment } from "../../../lib/services/clinicService";
import { combineIsoDateAndTime } from "../../doctor/utils/calendarUtils";

export const RescheduleFlow = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const { appointmentId, serviceId, serviceName, currentDate, currentTime } =
    location.state || {};

  // =========================================================================
  // EL ESCUDO ANTI-CICLOS (FIX DEFINITIVO PARA EL CPU)
  // Convertimos "2026-06-10T23:15:00+00:00" -> "2026-06-10"
  // =========================================================================
  const safeDate =
    typeof currentDate === "string" && currentDate.includes("T")
      ? currentDate.split("T")[0]
      : currentDate;

  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingData, setBookingData] = useState({
    serviceName: serviceName || "Consulta Médica",
    date: safeDate || "", // <--- USAMOS LA FECHA LIMPIA AQUÍ
    time: currentTime || "",
  });

  useEffect(() => {
    // PROTECCIÓN DE TITANIO CONTRA UUIDS FALSOS
    const isValidUUID = (id: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id || "",
      );

    if (!appointmentId || !serviceId || !isValidUUID(serviceId)) {
      console.error(
        "[RescheduleFlow] ALERTA: Datos inválidos. Deteniendo ciclo infinito. Expulsando al dashboard...",
        { appointmentId, serviceId },
      );
      navigate("/dashboard");
    }
  }, [appointmentId, serviceId, navigate]);

  // Si los datos son inválidos, ni siquiera intentamos renderizar
  if (!appointmentId || !serviceId || !/^[0-9a-f]{8}-/i.test(serviceId))
    return null;

  const handleDateTimeSubmit = async (newDate: string, newTime: string) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    const loadingToast = toast.loading("Reprogramando tu cita...");

    try {
      const utcIsoDateTime = combineIsoDateAndTime(newDate, newTime);
      await rescheduleAppointment(appointmentId, utcIsoDateTime);

      setBookingData((prev) => ({ ...prev, date: newDate, time: newTime }));
      toast.success("Cita reprogramada con éxito.", { id: loadingToast });
      setStep(2);
    } catch (error: unknown) {
      console.error("[RescheduleFlow] Error al reprogramar la cita:", error);
      toast.error("Error al reprogramar la cita.", { id: loadingToast });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pt-8 xl:pt-10 px-4 sm:px-6">
      <div className="bg-white rounded-[3rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-6 sm:p-12 overflow-hidden relative min-h-150 flex flex-col justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(var(--color-brand-primary)_1px,transparent_1px)] bg-size-[32px_32px] opacity-[0.02] pointer-events-none"></div>

        <div className="relative z-10 flex justify-center w-full">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full flex justify-center relative"
              >
                {isSubmitting && (
                  <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-3xl">
                    <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
                    <p className="font-bold text-brand-dark">
                      Conectando con la agenda...
                    </p>
                  </div>
                )}

                <DateTimeSelector
                  serviceId={serviceId}
                  initialDate={bookingData.date} // AHORA RECIBE LA FECHA SEGURA
                  initialTime={bookingData.time}
                  isDirectMode={true}
                  onBack={() => navigate("/dashboard")}
                  onSubmit={handleDateTimeSubmit}
                />
              </motion.div>
            )}

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
                  isReschedule={true}
                  onGoToDashboard={() => navigate("/dashboard")}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
