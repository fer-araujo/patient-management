import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "../../../components/ui/Button";

/**
 * Shown when a signed-in account's role could not be read (network or server
 * error). It is NOT a denial: the account may well be the doctor's, so the
 * only action is to try again.
 */
export const RoleErrorScreen = ({ onRetry }: { onRetry: () => void }) => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
    <div
      role="alert"
      className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-center space-y-5"
    >
      <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto text-amber-600">
        <WifiOff className="w-8 h-8" strokeWidth={2.5} aria-hidden="true" />
      </div>
      <h1 className="text-xl font-bold text-brand-dark">No se pudo verificar tu cuenta</h1>
      <p className="text-base text-brand-gray leading-relaxed">
        Revisa tu conexión a internet e inténtalo de nuevo.
      </p>
      <Button type="button" onClick={onRetry} className="min-h-11 rounded-xl text-base">
        <RefreshCw className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" /> Reintentar
      </Button>
    </div>
  </div>
);
