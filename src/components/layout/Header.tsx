import { HeartPulse, LogOut, Settings, LayoutDashboard } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { supabase } from "../../lib/supabase";
import {
  useAuthRole,
  isStaffRole,
  isDoctorRole,
} from "../../features/auth/useAuthRole";

export const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useAuthRole();

  // Staff controls are gated by the session role, never by the URL: a patient
  // who navigates to a /doctor path must not see clinic administration links.
  const isStaff = isStaffRole(role);
  // Only the doctor may open Centro Clínico; an admin account only ever gets
  // the Administración entry.
  const canOpenClinical = isDoctorRole(role);

  // Which of the two staff views is active is a presentation concern, so it is
  // still derived from the current path.
  const isAdminView = location.pathname.includes("/admin");
  const showClinicalEntry = canOpenClinical && isAdminView;

  const handleLogout = async () => {
    try {
      const loadingToast = toast.loading("Cerrando sesión...");
      await supabase.auth.signOut();
      toast.success("Sesión cerrada de forma segura.", { id: loadingToast });
      // "/" follows the clinic mode (App.tsx HomeRoute): the public booking
      // page normally, the clinic's sign-in in doctor-only mode. Never the
      // patient portal.
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

      {/* CONTROLES DERECHOS */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* 2. LOS BOTONES DE ADMIN SOLO SE RENDERIZAN SI LA CUENTA ES DEL EQUIPO MÉDICO */}
        {isStaff && (
          <>
            {showClinicalEntry ? (
              <button
                onClick={() => navigate("/doctor/dashboard")}
                className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-brand-primary/10 text-brand-primary hover:bg-brand-primary hover:text-white rounded-xl transition-all cursor-pointer font-bold text-sm group"
                title="Volver a Consultas"
              >
                <LayoutDashboard
                  className="w-5 h-5 group-hover:scale-105 transition-transform"
                  strokeWidth={2.5}
                />
                <span className="hidden sm:inline">Centro Clínico</span>
              </button>
            ) : (
              <button
                onClick={() => navigate("/doctor/admin")}
                className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-slate-100 text-brand-dark hover:bg-slate-200 rounded-xl transition-all cursor-pointer font-bold text-sm group"
                title="Administración del Negocio"
              >
                <Settings
                  className="w-5 h-5 text-brand-gray group-hover:rotate-45 transition-transform"
                  strokeWidth={2.5}
                />
                <span className="hidden sm:inline">Administración</span>
              </button>
            )}

            {/* LÍNEA DIVISORIA SOLO PARA LA DOCTORA */}
            <div className="w-px h-8 bg-slate-200 mx-1 hidden sm:block"></div>
          </>
        )}

        {/* BOTÓN DE CERRAR SESIÓN (Este sí lo ven todos) */}
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
      </div>
    </header>
  );
};
