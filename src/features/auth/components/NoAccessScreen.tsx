import { useState } from "react";
import { LogOut, Phone } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "../../../lib/supabase";
import { Button } from "../../../components/ui/Button";

/**
 * Shown in doctor-only mode to a signed-in account that is not clinic staff
 * (e.g. a patient session left over from before the mode was turned on).
 * There is no patient portal to send it to, so it can only sign out.
 */
export const NoAccessScreen = () => {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
    } catch (error: unknown) {
      console.error("[NoAccessScreen] Error al cerrar sesión:", error);
      toast.error("Hubo un problema al cerrar la sesión.");
      setIsSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-center space-y-5">
        <div className="w-16 h-16 bg-brand-light/40 rounded-full flex items-center justify-center mx-auto text-brand-primary">
          <Phone className="w-8 h-8" strokeWidth={2.5} />
        </div>
        <h1 className="text-xl font-bold text-brand-dark">
          Esta cuenta no tiene acceso
        </h1>
        <p className="text-base text-brand-gray leading-relaxed">
          La clínica no usa el portal de pacientes por ahora. Para tu cita,
          comunícate por teléfono con la clínica.
        </p>
        <Button
          type="button"
          onClick={handleLogout}
          disabled={isSigningOut}
          className="min-h-11 rounded-xl text-base disabled:opacity-50"
        >
          <LogOut className="w-5 h-5" strokeWidth={2.5} /> Cerrar sesión
        </Button>
      </div>
    </div>
  );
};
