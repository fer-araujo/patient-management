import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { ServiceSelector } from "./ServiceSelector";
import { DateTimeSelector } from "./DateTimeSelector";
import { BookingSuccess } from "./BookingSuccess";

import { createAuthenticatedAppointment } from "../../../lib/services/patientBookingService";
import toast from "react-hot-toast";

export const DashboardBooking = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const initialService = location.state?.preselectedService || "";
  const initialServiceName =
    location.state?.preselectedServiceName || "Consulta Médica";
  const initialStep = initialService ? 2 : 1;

  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [bookingData, setBookingData] = useState({
    serviceId: initialService,
    serviceName: initialServiceName, // <--- AÑADIDO
    date: "",
    time: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleServiceSelect = (serviceId: string, serviceName?: string) => {
    setBookingData((prev) => ({
      ...prev,
      serviceId,
      serviceName: serviceName || "Consulta Médica",
    }));
    setStep(2);
  };

  const handleDateTimeSubmit = async (date: string, time: string) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    const loadingToast = toast.loading("Registrando tu cita...");

    try {
      await createAuthenticatedAppointment(bookingData.serviceId, date, time);

      setBookingData((prev) => ({ ...prev, date, time }));
      toast.success("Cita solicitada con éxito.", { id: loadingToast });
      setStep(3);
    } catch (error: unknown) {
      console.error(error);
      toast.error((error as Error).message || "No se pudo registrar la cita.", {
        id: loadingToast,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBookAnother = () => {
    setBookingData({
      serviceId: "",
      serviceName: "Consulta Médica",
      date: "",
      time: "",
    });
    setStep(1);
    navigate(location.pathname, { replace: true, state: {} });
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
                className="w-full flex justify-center"
              >
                <ServiceSelector
                  isDirectMode={true}
                  onBack={() => navigate("/dashboard")}
                  onSelect={handleServiceSelect}
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
                <DateTimeSelector
                  isDirectMode={initialStep === 2}
                  serviceId={bookingData.serviceId}
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
                  isReschedule={false}
                  onGoToDashboard={() => navigate("/dashboard")}
                  onGoHome={handleBookAnother}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
