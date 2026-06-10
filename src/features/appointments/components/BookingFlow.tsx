import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, ShieldCheck, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

import { PatientPhoneLogin } from "../../auth/components/PatientPhoneLogin";
import { PatientRegistration } from "../../auth/components/PatientRegistration";
import { ServiceSelector } from "./ServiceSelector";
import { DateTimeSelector } from "./DateTimeSelector";
import { BookingSuccess } from "./BookingSuccess";
import { Badge } from "../../../components/ui/Badge";
import { createPublicPatientAndAppointment } from "../../../lib/services/patientBookingService";

interface BookingFlowProps {
  onComplete: () => void;
}

interface PatientRegistrationData {
  fullName: string;
  email: string;
  birthYear: string;
  reason: string;
  termsAccepted: boolean;
}

interface BookingState {
  code: string;
  number: string;
  patientData: PatientRegistrationData | null;
  serviceId: string;
  serviceName?: string; // <--- AÑADIDO
  date: string;
  time: string;
}

export const BookingFlow = ({ onComplete }: BookingFlowProps) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  const [bookingData, setBookingData] = useState<BookingState>({
    code: "+52",
    number: "",
    patientData: null,
    serviceId: "",
    serviceName: "Consulta Médica", // Valor por defecto
    date: "",
    time: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleNewPatientPhoneSubmit = (code: string, number: string) => {
    setBookingData((prev) => ({ ...prev, code, number }));
    setCurrentStep(2);
  };

  const handleLoginSuccess = (code: string, number: string) => {
    console.log("Login exitoso:", code, number);
    onComplete();
  };

  const handleRegistrationSubmit = (data: PatientRegistrationData) => {
    setBookingData((prev) => ({ ...prev, patientData: data }));
    setCurrentStep(3);
  };

  // Preparamos el handle para aceptar el nombre del servicio si el selector se lo envía
  const handleServiceSelect = (serviceId: string, serviceName?: string) => {
    setBookingData((prev) => ({
      ...prev,
      serviceId,
      serviceName: serviceName || "Consulta Médica",
    }));
    setCurrentStep(4);
  };

  const handleDateTimeSubmit = async (date: string, time: string) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    const loadingToast = toast.loading("Procesando tu solicitud de cita...");

    try {
      await createPublicPatientAndAppointment({
        phone: bookingData.code + bookingData.number,
        serviceId: bookingData.serviceId,
        date,
        time,
        fullName: bookingData.patientData?.fullName || "Paciente Desconocido",
        email: bookingData.patientData?.email || "",
        reason: bookingData.patientData?.reason || "",
      });

      setBookingData((prev) => ({ ...prev, date, time }));
      toast.success("¡Solicitud enviada correctamente!", { id: loadingToast });
      setCurrentStep(5);
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        (error as Error).message || "Hubo un error al procesar tu cita.",
        { id: loadingToast },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoHome = () => {
    setCurrentStep(1);
    setBookingData({
      code: "+52",
      number: "",
      patientData: null,
      serviceId: "",
      serviceName: "Consulta Médica",
      date: "",
      time: "",
    });
  };

  return (
    <div className="min-h-screen w-full bg-white flex flex-col lg:flex-row font-sans antialiased selection:bg-brand-primary/20 overflow-hidden relative">
      <div className="w-full lg:w-[45%] flex flex-col justify-center px-8 sm:px-16 lg:pl-12 xl:pl-50 lg:pr-8 xl:pr-12 py-12 relative z-20 bg-white overflow-y-auto">
        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <PatientPhoneLogin
              key="step1"
              onSubmitNewPatient={handleNewPatientPhoneSubmit}
              onLoginSuccess={handleLoginSuccess}
            />
          )}

          {currentStep === 2 && (
            <PatientRegistration
              key="step2"
              onBack={() => setCurrentStep(1)}
              onSubmit={handleRegistrationSubmit}
            />
          )}

          {currentStep === 3 && (
            <ServiceSelector
              key="step3"
              onBack={() => setCurrentStep(2)}
              onSelect={handleServiceSelect}
            />
          )}

          {currentStep === 4 && (
            <DateTimeSelector
              key="step4"
              serviceId={bookingData.serviceId}
              onBack={() => setCurrentStep(3)}
              onSubmit={handleDateTimeSubmit}
            />
          )}

          {currentStep === 5 && (
            <BookingSuccess
              key="step5"
              bookingData={bookingData}
              onGoToDashboard={onComplete}
              onGoHome={handleGoHome}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="hidden lg:flex flex-1 relative bg-linear-to-r from-white via-brand-primary/5 to-brand-primary/10 items-center justify-center p-8 xl:p-12 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(var(--color-brand-primary)_1px,transparent_1px)] bg-size-[32px_32px] opacity-[0.05] z-0 pointer-events-none"></div>

        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 120, repeat: Infinity, ease: "linear" }}
          className="absolute w-100 xl:w-150 h-100 xl:h-150 bg-linear-to-tr from-brand-light to-brand-light/30 shadow-2xl shadow-brand-primary/10 z-0"
          style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }}
        />

        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 150, repeat: Infinity, ease: "linear" }}
          className="absolute w-75 xl:w-112.5 h-75 xl:h-112.5 bg-brand-primary/5 border border-brand-primary/10 z-0"
          style={{ borderRadius: "60% 40% 30% 70% / 50% 60% 40% 50%" }}
        />

        <div className="relative z-10 flex flex-col items-center">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="w-full max-w-75 xl:max-w-95 bg-white/90 backdrop-blur-xl rounded-4xl border border-white p-6 xl:p-8 shadow-[0_30px_60px_-15px_rgba(7,169,150,0.12)] relative"
          >
            <div className="flex items-center justify-between mb-6 xl:mb-8">
              <div className="flex items-center gap-3 xl:gap-4">
                <div className="w-10 xl:w-12 h-10 xl:h-12 rounded-xl xl:rounded-2xl bg-brand-light flex items-center justify-center text-brand-primary shadow-inner shrink-0">
                  <Activity
                    strokeWidth={2.5}
                    className="w-5 xl:w-6 h-5 xl:h-6"
                  />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-brand-dark leading-tight">
                    Terapias Integrales
                  </p>
                  <p className="text-[10px] xl:text-xs font-semibold text-brand-gray/60 uppercase tracking-wider mt-0.5">
                    enfocadas en restaurar tu bienestar
                  </p>
                </div>
              </div>
              <span className="relative flex h-2.5 w-2.5 xl:h-3 xl:w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 xl:h-3 xl:w-3 bg-brand-primary"></span>
              </span>
            </div>

            <div className="w-full h-16 xl:h-24 relative flex items-center justify-center">
              <svg
                viewBox="0 0 200 50"
                className="w-full h-full overflow-visible"
              >
                <path
                  d="M0 25 L20 25 L30 10 L40 45 L50 25 L80 25 L90 15 L100 35 L110 25 L140 25 L150 5 L160 40 L170 25 L200 25"
                  fill="none"
                  stroke="var(--color-brand-light)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <motion.path
                  d="M0 25 L20 25 L30 10 L40 45 L50 25 L80 25 L90 15 L100 35 L110 25 L140 25 L150 5 L160 40 L170 25 L200 25"
                  fill="none"
                  stroke="var(--color-brand-primary)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    ease: "linear",
                    repeatType: "loop",
                  }}
                />
              </svg>
            </div>
          </motion.div>

          <motion.div
            initial={{ y: 0 }}
            animate={{ y: [-6, 6, -6] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -left-32 -top-20 z-20 scale-90 xl:scale-100"
          >
            <Badge
              icon={<ShieldCheck className="w-5 h-5" />}
              title="Atención Personalizada"
              subtitle="ESCUCHAMOS TU SALUD"
            />
          </motion.div>

          <motion.div
            initial={{ y: 0 }}
            animate={{ y: [6, -6, 6] }}
            transition={{
              duration: 6,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 1,
            }}
            className="absolute -right-32 -bottom-10 z-20 scale-90 xl:scale-100"
          >
            <Badge
              icon={<Sparkles className="w-5 h-5" />}
              title="Medicina Estética"
              subtitle="SALUD, BIENESTAR Y EQUILIBRIO"
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
};
