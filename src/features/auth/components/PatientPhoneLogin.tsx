import { useState } from "react";
import {
  HeartPulse,
  ChevronDown,
  ArrowRight,
  ShieldCheck,
  User,
  Lock,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";

import { supabase } from "../../../lib/supabase";

// The portal never tells the visitor whether a number is registered, so both
// outcomes of a login attempt show exactly this text.
const NEUTRAL_OTP_MESSAGE =
  "Si el número está registrado, recibirás un código de acceso.";

// Booking sends the code to every number, registered or not, so the booking
// message says so plainly. It is equally neutral: the same text for every
// number, and nothing about whether the number has a clinical record.
const BOOKING_OTP_MESSAGE = "Te enviamos un código de verificación.";

type OtpPurpose = "booking" | "login";

interface Props {
  /** The visitor proved ownership of the phone from the "Agendar Cita" path. */
  onBookingVerified: () => void;
  /** The visitor signed in from the "Entrar a mi Portal" path. */
  onLoginSuccess: () => void;
}

export const PatientPhoneLogin = ({
  onBookingVerified,
  onLoginSuccess,
}: Props) => {
  const [countryCode, setCountryCode] = useState("+52");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [otpPurpose, setOtpPurpose] = useState<OtpPurpose>("booking");

  const [mode, setMode] = useState<"new" | "login_phone" | "login_otp">(
    "new",
  );
  const navigate = useNavigate();

  const isPhoneComplete = (): boolean => {
    // FIX DE UX: Validamos explícitamente y avisamos al paciente
    if (phoneNumber.length < 10) {
      const faltan = 10 - phoneNumber.length;
      toast.error(
        `Ingresa un número a 10 dígitos (te falta${faltan > 1 ? "n" : ""} ${faltan}).`,
      );
      return false;
    }
    return true;
  };

  // Always request the code and always report the same outcome. Branching on
  // whether the number is known - or surfacing the provider's error - would
  // turn this form into a patient-list oracle.
  const sendOtp = async (purpose: OtpPurpose) => {
    setIsLoading(true);
    const fullPhone = countryCode + phoneNumber;

    const { error } = await supabase.auth.signInWithOtp({ phone: fullPhone });
    if (error) {
      console.error("[PatientPhoneLogin] OTP request failed:", error);
    }

    setOtp("");
    setOtpPurpose(purpose);
    setMode("login_otp");
    toast.success(
      purpose === "booking" ? BOOKING_OTP_MESSAGE : NEUTRAL_OTP_MESSAGE,
    );
    setIsLoading(false);
  };

  // =========================================================
  // FLUJO 1: "Agendar Cita" (Botón público principal)
  // =========================================================
  // Booking starts by verifying the phone. Only after the OTP proves the
  // visitor owns the number does the app ask the server whether it already has
  // a clinical record, so the booking page is never a patient-list oracle.
  const handleNewPatientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPhoneComplete()) return;
    await sendOtp("booking");
  };

  // =========================================================
  // FLUJO 2: "Entrar a mi Portal" (Botón de login explícito)
  // =========================================================
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPhoneComplete()) return;
    await sendOtp("login");
  };

  // =========================================================
  // FLUJO 3: Validar el Código
  // =========================================================
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    // FIX DE UX: Validamos que ingrese todos los dígitos del OTP
    if (otp.length < 6) {
      // Asumo 6 dígitos de Supabase. Cámbialo a 4 si configuraste eso.
      toast.error("Ingresa el código completo enviado a tu celular.");
      return;
    }

    setIsLoading(true);
    const fullPhone = countryCode + phoneNumber;

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: fullPhone,
        token: otp,
        type: "sms",
      });

      if (error) throw error;

      if (data.session) {
        if (otpPurpose === "booking") {
          onBookingVerified();
        } else {
          onLoginSuccess();
        }
      }
    } catch (error) {
      console.error(error);
      toast.error("Código incorrecto o expirado.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.4 }}
      className="max-w-lg w-full mx-auto lg:mx-0"
    >
      <div className="inline-flex items-center gap-3 px-4 py-2 bg-brand-light/50 rounded-full border border-brand-light mb-8 xl:mb-12">
        <div className="bg-white p-1.5 rounded-full shadow-sm text-brand-primary">
          <HeartPulse className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-sm font-bold text-brand-dark tracking-wide">
            Dra. Carmen Torres
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {mode === "new" && (
          <motion.div
            key="new"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <h1 className="text-5xl sm:text-6xl lg:text-5xl xl:text-[4rem] font-bold text-brand-dark mb-6 leading-[1.05] tracking-tight">
              Cuidado médico <br /> que{" "}
              <span className="text-brand-primary">realmente</span> te escucha.
            </h1>
            <p className="text-lg xl:text-xl text-brand-gray/80 leading-relaxed font-medium mb-10 xl:mb-12 max-w-sm">
              Agende su consulta de forma rápida y segura. Sin contraseñas
              complicadas.
            </p>

            <form
              onSubmit={handleNewPatientSubmit}
              className="space-y-6 xl:space-y-8"
            >
              <div className="flex gap-3 sm:gap-4 items-end">
                <div className="relative w-28 sm:w-1/3 shrink-0">
                  <label className="text-brand-dark font-medium text-base xl:text-lg block mb-2 ml-1">
                    País
                  </label>
                  <div className="relative group">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="w-full appearance-none pl-3 pr-8 sm:px-4 py-3 xl:py-4 bg-white border-2 border-brand-light rounded-2xl text-base xl:text-lg font-semibold text-brand-dark focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all cursor-pointer group-hover:border-brand-primary/50"
                    >
                      <option value="+52">MX +52</option>
                      <option value="+1">US +1</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 sm:pr-4 text-brand-gray">
                      <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                  </div>
                </div>

                <Input
                  label="Número celular"
                  type="tel"
                  placeholder="55 1234 5678"
                  value={phoneNumber}
                  onChange={(e) =>
                    setPhoneNumber(e.target.value.replace(/\D/g, ""))
                  }
                  required
                  maxLength={10}
                  containerClassName="w-full"
                />
              </div>

              <div className="pt-2 xl:pt-4">
                {/* FIX DE UX: El botón ya NO está disabled por longitud de teléfono, solo por carga */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="group w-fit px-8 xl:px-10 rounded-full text-base xl:text-lg"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />{" "}
                      Verificando...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      Agendar Cita
                      <div className="bg-white/20 rounded-full p-1.5 ml-2 transition-transform duration-300 ease-out group-hover:translate-x-1.5">
                        <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
                      </div>
                    </span>
                  )}
                </Button>
              </div>
            </form>

            <div className="mt-8 flex items-center gap-2">
              <span className="text-brand-gray font-medium">
                ¿Ya eres paciente?
              </span>
              <button
                onClick={() => setMode("login_phone")}
                className="text-brand-primary font-bold hover:text-brand-dark transition-colors cursor-pointer flex items-center gap-1"
              >
                <User className="w-4 h-4" /> Entrar a mi Portal
              </button>
            </div>
          </motion.div>
        )}

        {mode === "login_phone" && (
          <motion.div
            key="login_phone"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <button
              onClick={() => setMode("new")}
              className="flex items-center gap-2 text-brand-gray hover:text-brand-dark font-bold text-sm mb-6 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Volver
            </button>
            <h1 className="text-4xl sm:text-5xl font-bold text-brand-dark mb-4 tracking-tight">
              Portal de <br /> Pacientes
            </h1>
            <p className="text-lg text-brand-gray/80 font-medium mb-10 max-w-sm">
              Ingresa tu número registrado para acceder a tu historial o agendar
              de nuevo.
            </p>

            <form onSubmit={handleRequestOtp} className="space-y-6">
              <div className="flex gap-3 sm:gap-4 items-end">
                <div className="relative w-28 sm:w-1/3 shrink-0">
                  <label className="text-brand-dark font-medium text-base xl:text-lg block mb-2 ml-1">
                    País
                  </label>
                  <div className="relative group">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="w-full appearance-none pl-3 pr-8 sm:px-4 py-3 xl:py-4 bg-white border-2 border-brand-light rounded-2xl text-base xl:text-lg font-semibold text-brand-dark focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all cursor-pointer group-hover:border-brand-primary/50"
                    >
                      <option value="+52">MX +52</option>
                      <option value="+1">US +1</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 sm:pr-4 text-brand-gray">
                      <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                  </div>
                </div>

                <Input
                  label="Número celular"
                  type="tel"
                  placeholder="55 1234 5678"
                  value={phoneNumber}
                  onChange={(e) =>
                    setPhoneNumber(e.target.value.replace(/\D/g, ""))
                  }
                  required
                  maxLength={10}
                  containerClassName="w-full"
                  autoFocus
                />
              </div>

              {/* FIX DE UX: El botón ya NO está disabled por longitud */}
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full sm:w-fit px-8 py-3.5 rounded-2xl text-base group"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  <>
                    Recibir código
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </form>
          </motion.div>
        )}

        {mode === "login_otp" && (
          <motion.div
            key="login_otp"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <button
              onClick={() =>
                setMode(otpPurpose === "booking" ? "new" : "login_phone")
              }
              className="flex items-center gap-2 text-brand-gray hover:text-brand-dark font-bold text-sm mb-6 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Cambiar número
            </button>
            <h1 className="text-4xl sm:text-5xl font-bold text-brand-dark mb-4 tracking-tight">
              Ingresa tu código
            </h1>
            <p className="text-lg text-brand-gray/80 font-medium mb-10 max-w-sm">
              {otpPurpose === "booking"
                ? "Para proteger tus datos, enviamos un código por WhatsApp al"
                : "Si el número está registrado, enviamos un código por WhatsApp al"}{" "}
              <span className="font-bold text-brand-dark">
                {countryCode} {phoneNumber}
              </span>
            </p>

            <form onSubmit={handleVerifyOtp} className="space-y-6">
              <div className="relative max-w-xs">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-6 w-6 text-brand-gray/40" />
                </div>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  className="block w-full pl-12 pr-4 py-4 text-center tracking-[0.75em] bg-white border-2 border-brand-light rounded-2xl text-brand-dark font-black text-3xl focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-all outline-none"
                  placeholder="••••••"
                  maxLength={6} // Verifica si usas 6 o 4 en Supabase
                  autoFocus
                />
              </div>

              {/* FIX DE UX: El botón ya NO está disabled por longitud */}
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full sm:w-fit px-10 py-3.5 rounded-2xl text-base group"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  <>
                    {otpPurpose === "booking"
                      ? "Verificar y Continuar"
                      : "Verificar y Entrar"}
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-12 xl:mt-16 pt-6 border-t border-brand-light flex items-center justify-between relative z-20">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-brand-primary shrink-0" />
          <p className="text-sm font-medium text-brand-gray">
            Su privacidad es nuestra prioridad.{" "}
            <br className="hidden sm:block lg:hidden" /> Conexión segura y
            encriptada.
          </p>
        </div>
        <button
          onClick={() => navigate("/doctor/dashboard")}
          className="p-2 text-brand-gray/30 hover:text-brand-primary transition-colors cursor-pointer rounded-full hover:bg-brand-primary/5"
          title="Acceso Médico"
        >
          <Lock className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
};
