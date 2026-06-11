import { HeartPulse, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { supabase } from "../../lib/supabase";

export const Header = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      const loadingToast = toast.loading("Cerrando sesión...");
      await supabase.auth.signOut();
      toast.success("Sesión cerrada de forma segura.", { id: loadingToast });
      navigate("/");
    } catch (error: unknown) {
      console.error("[Header] Error al cerrar sesión:", error);
      toast.error("Hubo un problema al cerrar la sesión.");
    }
  };

  return (
    <header className="bg-white border-b border-brand-light/50 sticky top-0 z-30 px-6 py-4 flex justify-between items-center shadow-sm shadow-brand-primary/5">
      {/* LOGO */}
      <div className="flex items-center gap-3">
        <div className="bg-brand-light/50 p-2 rounded-xl text-brand-primary">
          <HeartPulse className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <span className="font-extrabold text-brand-dark tracking-tight text-xl">
          Clínica Torres
        </span>
      </div>

      {/* BOTÓN DE CERRAR SESIÓN */}
      <button
        onClick={handleLogout}
        className="flex items-center gap-2 p-2 sm:px-4 sm:py-2 text-brand-gray/50 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all cursor-pointer group"
        title="Cerrar sesión"
      >
        <span className="hidden sm:inline font-bold text-sm">
          Cerrar sesión
        </span>
        <LogOut
          className="w-5 h-5 group-hover:scale-110 transition-transform"
          strokeWidth={2.5}
        />
      </button>
    </header>
  );
};
