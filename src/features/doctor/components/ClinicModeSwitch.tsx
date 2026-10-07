import { useState } from "react";
import { RefreshCw, UserRound } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { useClinicMode } from "../../clinicMode/useClinicMode";

/**
 * "Modo solo doctora" switch for the doctor's Centro de Comando. Every change
 * goes through a confirmation that says what patients will (not) be able to do.
 */
export const ClinicModeSwitch = () => {
  const { doctorOnlyMode, loading, error, retry, setDoctorOnlyMode } = useClinicMode();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const next = !doctorOnlyMode;

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      await setDoctorOnlyMode(next);
      toast.success(
        next ? "Modo solo doctora activado." : "Modo solo doctora desactivado.",
      );
      setIsConfirmOpen(false);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo cambiar el modo de la clínica.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Unknown mode: never show a false "Desactivado"; offer to read it again.
  if (error) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 min-h-11 px-5 py-2.5 rounded-full text-base font-bold border bg-amber-50 border-amber-200 text-amber-800"
      >
        <UserRound className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" />
        <span>Modo solo doctora</span>
        <span className="font-semibold">No se pudo leer el modo</span>
        <button
          type="button"
          onClick={retry}
          className="flex items-center gap-2 min-h-11 px-4 rounded-full bg-white border border-amber-300 text-amber-800 font-bold cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={doctorOnlyMode}
        aria-label="Modo solo doctora"
        disabled={loading}
        onClick={() => setIsConfirmOpen(true)}
        className={`flex items-center gap-3 min-h-11 px-5 max-md:px-4 py-2.5 max-md:w-full rounded-full text-base font-bold border transition-all cursor-pointer disabled:opacity-50 ${doctorOnlyMode ? "bg-brand-light/30 border-brand-primary/30 text-brand-dark" : "bg-slate-100 border-slate-200 text-brand-gray"}`}
      >
        <UserRound className="w-5 h-5" strokeWidth={2.5} />
        <span className="max-md:flex-1 max-md:text-left">Modo solo doctora</span>
        <span
          aria-hidden="true"
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${doctorOnlyMode ? "bg-brand-primary" : "bg-slate-300"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white border transition-all ${doctorOnlyMode ? "translate-x-full border-white" : "border-gray-300"}`}
          />
        </span>
        <span className={doctorOnlyMode ? "text-brand-primary" : "text-brand-gray"}>
          {doctorOnlyMode ? "Activado" : "Desactivado"}
        </span>
      </button>

      <Modal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title={next ? "Activar modo solo doctora" : "Desactivar modo solo doctora"}
        icon={<UserRound className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        <div className="space-y-6 pb-2 text-center">
          <p className="text-base text-brand-dark leading-relaxed">
            {next
              ? "Los pacientes no podrán reservar en línea ni entrar al portal. Las citas las registras tú."
              : "Los pacientes podrán volver a reservar en línea y entrar a su portal."}
          </p>
          {next && (
            <p className="text-base text-brand-gray leading-relaxed">
              Solo recibirán avisos de sus citas por WhatsApp.
            </p>
          )}
          <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsConfirmOpen(false)}
              className="flex-1 min-h-11 py-3.5 rounded-xl cursor-pointer text-base"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={isSaving}
              className="flex-1 min-h-11 py-3.5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md cursor-pointer disabled:opacity-50 font-bold text-base"
            >
              {isSaving
                ? "Guardando..."
                : next
                  ? "Sí, activar"
                  : "Sí, desactivar"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
