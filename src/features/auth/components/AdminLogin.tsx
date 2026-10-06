import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, ShieldCheck, Lock, ArrowRight, Loader2, AlertCircle, ArrowLeft, CalendarDays, Package } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Badge } from "../../../components/ui/Badge";
import { useClinicMode } from "../../clinicMode/useClinicMode";

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

export const AdminLogin = ({ onLoginSuccess }: AdminLoginProps) => {
  const navigate = useNavigate();
  // In doctor-only mode "/" IS this sign-in: there is no patient portal to go back to.
  const { doctorOnlyMode } = useClinicMode();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw authError;
      }

      if (data.session) {
        onLoginSuccess();
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes("Invalid login credentials")) {
          setError("Correo corporativo o contraseña incorrectos.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Ocurrió un error inesperado al intentar iniciar sesión.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white flex flex-col lg:flex-row font-sans antialiased selection:bg-brand-primary/20 overflow-hidden relative">
      
      {/* =========================================
          COLUMNA IZQUIERDA: Formulario Administrativo
          ========================================= */}
      <div className="w-full lg:w-[45%] flex flex-col justify-center px-8 sm:px-16 lg:pl-12 xl:pl-50 lg:pr-8 xl:pr-12 py-12 relative z-20 bg-white overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="max-w-lg w-full mx-auto lg:mx-0"
        >
          <div className="inline-flex items-center gap-3 px-4 py-2 bg-brand-light/50 rounded-full border border-brand-light mb-8 xl:mb-12">
            <div className="bg-white p-1.5 rounded-full shadow-sm text-brand-primary">
              <Lock className="w-5 h-5" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-sm font-bold text-brand-dark tracking-wide">
                Acceso Médico
              </p>
            </div>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-5xl xl:text-[4rem] font-bold text-brand-dark mb-6 leading-[1.05] tracking-tight">
            Centro de <br />
            mando <span className="text-brand-primary">clínico</span>
          </h1>

          <p className="text-lg xl:text-xl text-brand-gray/80 leading-relaxed font-medium mb-10 xl:mb-12 max-w-sm">
            Administre su agenda, expedientes de pacientes y catálogo de tratamientos en un solo lugar.
          </p>

          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8 p-4 bg-rose-50/50 border border-rose-100 rounded-2xl flex items-start gap-3 text-rose-600 text-sm font-bold">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{error}</p>
            </motion.div>
          )}

          <form onSubmit={handleLogin} className="space-y-6 xl:space-y-8">
            <div className="space-y-4 sm:space-y-6">
              <Input
                label="Correo corporativo"
                type="email"
                placeholder="dra.carmen@clinicatorres.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                containerClassName="w-full"
                autoFocus
              />

              <Input
                label="Contraseña"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                containerClassName="w-full"
              />
            </div>

            <div className="pt-2 xl:pt-4">
              <Button
                type="submit"
                disabled={isLoading || !email || !password}
                className="group w-full sm:w-fit px-8 xl:px-10 rounded-full text-base xl:text-lg disabled:opacity-70"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" /> Verificando...
                  </span>
                ) : (
                  <span className="flex items-center">
                    Iniciar Sesión
                    <div className="bg-white/20 rounded-full p-1.5 ml-2 transition-transform duration-300 ease-out group-hover:translate-x-1.5">
                      <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
                    </div>
                  </span>
                )}
              </Button>
            </div>
          </form>

          {!doctorOnlyMode && (
            <div className="mt-8 flex items-center justify-between gap-2 max-w-sm">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="text-brand-gray/80 font-bold hover:text-brand-dark transition-colors cursor-pointer flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Volver al portal de pacientes
              </button>
            </div>
          )}
          
          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center gap-2 text-xs font-medium text-slate-400">
            <ShieldCheck className="w-4 h-4 text-teal-500" />
            Acceso exclusivo para la Dra. Carmen Torres y personal autorizado.
          </div>
        </motion.div>
      </div>

      {/* =========================================
          COLUMNA DERECHA: Visuales
          ========================================= */}
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
                  <Activity strokeWidth={2.5} className="w-5 xl:w-6 h-5 xl:h-6" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-brand-dark leading-tight">
                    Expediente Clínico
                  </p>
                  <p className="text-[10px] xl:text-xs font-semibold text-brand-gray/60 uppercase tracking-wider mt-0.5">
                    HISTORIAL Y CONSULTAS AL DÍA
                  </p>
                </div>
              </div>
              <span className="relative flex h-2.5 w-2.5 xl:h-3 xl:w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 xl:h-3 xl:w-3 bg-brand-primary"></span>
              </span>
            </div>

            <div className="w-full h-16 xl:h-24 relative flex items-center justify-center">
              <svg viewBox="0 0 200 50" className="w-full h-full overflow-visible">
                <path d="M0 25 L20 25 L30 10 L40 45 L50 25 L80 25 L90 15 L100 35 L110 25 L140 25 L150 5 L160 40 L170 25 L200 25" fill="none" stroke="var(--color-brand-light)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                <motion.path
                  d="M0 25 L20 25 L30 10 L40 45 L50 25 L80 25 L90 15 L100 35 L110 25 L140 25 L150 5 L160 40 L170 25 L200 25"
                  fill="none"
                  stroke="var(--color-brand-primary)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "linear", repeatType: "loop" }}
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
              icon={<CalendarDays className="w-5 h-5" />}
              title="Agenda Inteligente"
              subtitle="CONTROL TOTAL DE CITAS"
            />
          </motion.div>

          <motion.div
            initial={{ y: 0 }}
            animate={{ y: [6, -6, 6] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="absolute -right-32 -bottom-10 z-20 scale-90 xl:scale-100"
          >
            <Badge
              icon={<Package className="w-5 h-5" />}
              title="Control de Clínica"
              subtitle="INVENTARIO Y TRATAMIENTOS"
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
};