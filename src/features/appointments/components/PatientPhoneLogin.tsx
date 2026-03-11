import { useState } from "react";
import {
  HeartPulse,
  ChevronDown,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Activity,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Badge } from "../../../components/ui/Badge";

export const PatientPhoneLogin = () => {
  const [countryCode, setCountryCode] = useState("+52");
  const [phoneNumber, setPhoneNumber] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Teléfono:", `${countryCode} ${phoneNumber}`);
    // Siguiente paso: Año de Nacimiento
  };

  return (
    <div className="min-h-screen w-full bg-white flex flex-col lg:flex-row font-sans antialiased selection:bg-brand-primary/20 overflow-hidden relative">
      {/* =========================================
          COLUMNA IZQUIERDA: Formulario
          ========================================= */}
      {/* CORRECCIÓN RESPONSIVE: 
          En lg (1024px) usamos pl-12 y pr-8 para no asfixiar el texto. 
          En xl (1280px+) regresamos al pl-32 para el look editorial. */}
      <div className="w-full lg:w-[45%] flex flex-col justify-center px-8 sm:px-16 lg:pl-12 xl:pl-50 lg:pr-8 xl:pr-12 py-12 relative z-20 bg-white">
        <div className="max-w-lg w-full mx-auto lg:mx-0">
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

          {/* CORRECCIÓN RESPONSIVE: En lg reducimos a text-5xl, en xl sube a 4rem */}
          <h1 className="text-5xl sm:text-6xl lg:text-5xl xl:text-[4rem] font-bold text-brand-dark mb-6 leading-[1.05] tracking-tight">
            Cuidado médico <br />
            que <span className="text-brand-primary">realmente</span> <br />
            te escucha.
          </h1>

          <p className="text-lg xl:text-xl text-brand-gray/80 leading-relaxed font-medium mb-10 xl:mb-12 max-w-sm">
            Agende su consulta de forma rápida y segura. Sin contraseñas
            complicadas.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6 xl:space-y-8">
            <div className="flex gap-4 items-end">
              <div className="relative w-1/3">
                <label className="text-brand-dark font-medium text-base xl:text-lg block mb-2 ml-1">
                  País
                </label>
                <div className="relative group">
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full appearance-none px-4 py-3 xl:py-4 bg-white border-2 border-brand-light rounded-2xl text-base xl:text-lg font-semibold text-brand-dark focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all cursor-pointer group-hover:border-brand-primary/50"
                  >
                    <option value="+52">MX +52</option>
                    <option value="+1">US +1</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-brand-gray">
                    <ChevronDown className="h-5 w-5" />
                  </div>
                </div>
              </div>

              <Input
                label="Número celular"
                type="tel"
                placeholder="55 1234 5678"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                required
                className="w-2/3"
              />
            </div>

            <div className="pt-2 xl:pt-4">
              <Button
                type="submit"
                className="group w-fit px-8 xl:px-10 rounded-full text-base xl:text-lg"
              >
                <span>Agendar Cita</span>
                <div className="bg-white/20 rounded-full p-1.5 ml-2 transition-transform duration-300 ease-out group-hover:translate-x-1.5">
                  <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
                </div>
              </Button>
            </div>
          </form>

          <div className="mt-12 xl:mt-16 pt-6 border-t border-brand-light flex items-center gap-3 relative z-20">
            <ShieldCheck className="w-5 h-5 text-brand-primary shrink-0" />
            <p className="text-sm font-medium text-brand-gray">
              Su privacidad es nuestra prioridad.{" "}
              <br className="hidden sm:block lg:hidden" /> Conexión segura y
              encriptada.
            </p>
          </div>
        </div>
      </div>

      {/* =========================================
          COLUMNA DERECHA: Abstract UI Composition
          ========================================= */}
      <div className="hidden lg:flex lg:w-[75%] relative bg-linear-to-r from-white via-brand-primary/5 to-brand-primary/10 items-center justify-center p-8 xl:p-12 z-0">
        {/* Patrón Base */}
        <div className="absolute inset-0 bg-[radial-gradient(var(--color-brand-primary)_1px,transparent_1px)] bg-size-[32px_32px] opacity-[0.05] z-0 pointer-events-none"></div>

        {/* LA FIGURA ASIMÉTRICA DE FONDO */}
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

        {/* EL CENTRO: UI COMPOSITION */}
        <div className="relative z-10 flex flex-col items-center">
          {/* Tarjeta Central "Hero" - ESCALA RESPONSIVE */}
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
                  {/* TEXTO PLACEHOLDER (A la espera de la diseñadora) */}
                  <p className="text-sm font-extrabold text-brand-dark leading-tight">
                    Sistema Clínico
                  </p>
                  <p className="text-[10px] xl:text-xs font-semibold text-brand-gray/60 uppercase tracking-wider mt-0.5">
                    Panel de Control
                  </p>
                </div>
              </div>
              <span className="relative flex h-2.5 w-2.5 xl:h-3 xl:w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 xl:h-3 xl:w-3 bg-brand-primary"></span>
              </span>
            </div>

            {/* Pulso SVG */}
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

          {/* LOS BADGES FLOTANTES - POSICIÓN RESPONSIVE */}

          <motion.div
            initial={{ y: 0 }}
            animate={{ y: [-6, 6, -6] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            /* CORRECCIÓN: En lg se pegan un poco más (-left-6), en xl se alejan (-left-32) */
            className="absolute -left-32 -top-20 z-20 scale-90 xl:scale-100"
          >
            <Badge
              icon={<ShieldCheck className="w-5 h-5" />}
              title="Privacidad Médica"
              subtitle="HISTORIAL PROTEGIDO"
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
            /* CORRECCIÓN: En lg se pegan un poco más (-right-6), en xl se alejan (-right-32) */
            className="absolute -right-32 -bottom-10 z-20 scale-90 xl:scale-100"
          >
            <Badge
              icon={<Sparkles className="w-5 h-5" />}
              title="Cuidado Especializado"
              subtitle="ESTÉTICA & OZONO"
            />
          </motion.div>
        </div>
      </div>
    </div>
  );  
};
