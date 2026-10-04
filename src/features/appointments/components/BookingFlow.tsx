import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

import { PatientPhoneLogin } from "../../auth/components/PatientPhoneLogin";
import {
  PatientRegistration,
  type PatientRegistrationData,
} from "../../auth/components/PatientRegistration";
import { PrivacyConsentStep } from "../../auth/components/PrivacyConsentStep";
import { useAuthRole, isStaffRole } from "../../auth/useAuthRole";
import { ServiceSelector } from "./ServiceSelector";
import { DateTimeSelector } from "./DateTimeSelector";
import { BookingSuccess } from "./BookingSuccess";
import { Badge } from "../../../components/ui/Badge";
import {
  acceptPrivacyNotice,
  createMyAppointment,
  fetchMyBookingProfile,
  registerMe,
  type MyBookingProfile,
} from "../../../lib/services/patientBookingService";
import { uploadPatientFile } from "../../../lib/services/storageService";

interface BookingFlowProps {
  onComplete: () => void;
}

interface BookingState {
  serviceId: string;
  serviceName?: string;
  date: string;
  time: string;
}

const EMPTY_BOOKING: BookingState = {
  serviceId: "",
  serviceName: "Consulta Médica", // Valor por defecto
  date: "",
  time: "",
};

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * Public booking. Steps:
 *   1. Phone + OTP. The code is always sent; nothing about the number is
 *      revealed until the visitor proves they own it.
 *   2. New patient: registration form. Returning patient without consent for
 *      the current notice: consent checkbox only. Otherwise skipped.
 *   3. Service. 4. Date, time and reason. 5. Success.
 * A visitor who arrives with an active non-staff session starts at step 2.
 */
export const BookingFlow = ({ onComplete }: BookingFlowProps) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [bookingData, setBookingData] = useState<BookingState>(EMPTY_BOOKING);
  const [profile, setProfile] = useState<MyBookingProfile | null>(null);
  const [isResolvingProfile, setIsResolvingProfile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { session, role, loading: isAuthLoading } = useAuthRole();
  const initialSessionChecked = useRef(false);

  // Runs only with a verified session: the answer describes the caller's own
  // phone, so telling them whether it is registered leaks nothing.
  const startVerifiedBooking = useCallback(async () => {
    setIsResolvingProfile(true);
    try {
      const myProfile = await fetchMyBookingProfile();
      setProfile(myProfile);

      if (myProfile.isRegistered && !myProfile.needsConsent) {
        toast.success(
          myProfile.firstName
            ? `¡Hola de nuevo, ${myProfile.firstName}!`
            : "¡Hola de nuevo!",
        );
        setCurrentStep(3);
      } else {
        setCurrentStep(2);
      }
    } catch (error: unknown) {
      console.error(error);
      toast.error(errorMessage(error, "No pudimos cargar tu información."));
      setCurrentStep(1);
    } finally {
      setIsResolvingProfile(false);
    }
  }, []);

  // A visitor who is already signed in as a patient skips the phone step.
  // Checked once, on the first resolved auth state; later sign-ins (the OTP
  // step itself) are handled by onBookingVerified.
  useEffect(() => {
    if (isAuthLoading || initialSessionChecked.current) return;
    initialSessionChecked.current = true;

    if (session && !isStaffRole(role)) {
      void startVerifiedBooking();
    }
  }, [isAuthLoading, session, role, startVerifiedBooking]);

  const handleRegistrationSubmit = async (data: PatientRegistrationData) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    const loadingToast = toast.loading("Creando tu expediente...");

    try {
      const patientId = await registerMe(data);

      // The optional study goes up only once the record exists. A failed
      // upload must not block the booking: the patient can retry from the
      // portal.
      if (data.file) {
        try {
          await uploadPatientFile(patientId, data.file, "patient");
        } catch (uploadError) {
          console.error(uploadError);
          toast.error(
            "Tu expediente se creó, pero no pudimos subir tu archivo. Puedes subirlo después desde tu portal.",
            { duration: 8000 },
          );
        }
      }

      setProfile({
        isRegistered: true,
        firstName: data.fullName.trim().split(/\s+/)[0] || null,
        needsConsent: false,
      });
      toast.success("Expediente creado correctamente.", { id: loadingToast });
      setCurrentStep(3);
    } catch (error: unknown) {
      console.error(error);
      toast.error(errorMessage(error, "No se pudo crear tu expediente."), {
        id: loadingToast,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConsentSubmit = async (privacyNoticeVersion: string) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    const loadingToast = toast.loading("Registrando tu aceptación...");

    try {
      await acceptPrivacyNotice(privacyNoticeVersion);
      setProfile((prev) => (prev ? { ...prev, needsConsent: false } : prev));
      toast.success("¡Gracias! Ya puedes agendar tu cita.", {
        id: loadingToast,
      });
      setCurrentStep(3);
    } catch (error: unknown) {
      console.error(error);
      toast.error(
        errorMessage(error, "No se pudo registrar tu aceptación."),
        { id: loadingToast },
      );
    } finally {
      setIsSubmitting(false);
    }
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

  const handleDateTimeSubmit = async (
    date: string,
    time: string,
    reason: string,
  ) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    const loadingToast = toast.loading("Procesando tu solicitud de cita...");

    try {
      await createMyAppointment(bookingData.serviceId, date, time, reason);

      setBookingData((prev) => ({ ...prev, date, time }));
      toast.success("¡Solicitud enviada correctamente!", { id: loadingToast });
      setCurrentStep(5);
    } catch (error: unknown) {
      console.error(error);
      toast.error(errorMessage(error, "Hubo un error al procesar tu cita."), {
        id: loadingToast,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // The visitor is still verified, so another booking starts at the service.
  const handleBookAnother = () => {
    setBookingData(EMPTY_BOOKING);
    setCurrentStep(3);
  };

  return (
    <div className="min-h-screen w-full bg-white flex flex-col lg:flex-row font-sans antialiased selection:bg-brand-primary/20 overflow-hidden relative">
      <div className="w-full lg:w-[45%] flex flex-col justify-center px-8 sm:px-16 lg:pl-12 xl:pl-50 lg:pr-8 xl:pr-12 py-12 relative z-20 bg-white overflow-y-auto">
        <AnimatePresence mode="wait">
          {isResolvingProfile && (
            <motion.div
              key="resolving"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20 w-full"
            >
              <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
              <p className="text-brand-gray font-medium">
                Cargando tu información...
              </p>
            </motion.div>
          )}

          {!isResolvingProfile && currentStep === 1 && (
            <PatientPhoneLogin
              key="step1"
              onBookingVerified={() => void startVerifiedBooking()}
              onLoginSuccess={onComplete}
            />
          )}

          {!isResolvingProfile &&
            currentStep === 2 &&
            profile?.isRegistered && (
              <PrivacyConsentStep
                key="step2-consent"
                firstName={profile.firstName}
                isSubmitting={isSubmitting}
                onBack={() => setCurrentStep(1)}
                onSubmit={handleConsentSubmit}
              />
            )}

          {!isResolvingProfile &&
            currentStep === 2 &&
            !profile?.isRegistered && (
              <PatientRegistration
                key="step2"
                isSubmitting={isSubmitting}
                onBack={() => setCurrentStep(1)}
                onSubmit={handleRegistrationSubmit}
              />
            )}

          {!isResolvingProfile && currentStep === 3 && (
            <ServiceSelector
              key="step3"
              onBack={() => setCurrentStep(1)}
              onSelect={handleServiceSelect}
            />
          )}

          {!isResolvingProfile && currentStep === 4 && (
            <DateTimeSelector
              key="step4"
              serviceId={bookingData.serviceId}
              showReasonField={true}
              onBack={() => setCurrentStep(3)}
              onSubmit={handleDateTimeSubmit}
            />
          )}

          {!isResolvingProfile && currentStep === 5 && (
            <BookingSuccess
              key="step5"
              bookingData={bookingData}
              onGoToDashboard={onComplete}
              onGoHome={handleBookAnother}
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
