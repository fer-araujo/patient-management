import { useEffect, useState } from "react";
import { FileSignature } from "lucide-react";
import { fetchPrescriberProfile } from "../../../lib/services/prescriberService";
import { missingPrescriberItems } from "./prescriberProfile";
import { PrescriberProfileModal } from "./PrescriberProfileModal";

/**
 * "Datos de la receta" in the doctor's Centro de Comando, next to the clinic
 * mode switch. Says "Faltan datos" while a prescription PDF cannot be issued.
 */
export const PrescriberProfileButton = () => {
  const [isOpen, setIsOpen] = useState(false);
  // Null until read (or when the read failed): then no badge is shown.
  const [isComplete, setIsComplete] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetchPrescriberProfile()
      .then((profile) => {
        if (active) setIsComplete(missingPrescriberItems(profile).length === 0);
      })
      .catch(() => {
        // Not critical here: the modal shows its own error.
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-3 min-h-11 px-5 max-md:px-4 py-2.5 max-md:w-full rounded-full text-base font-bold border transition-all cursor-pointer bg-slate-100 border-slate-200 text-brand-dark"
      >
        <FileSignature className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" />
        <span className="max-md:flex-1 max-md:text-left">Datos de la receta</span>
        {isComplete === false && (
          <span className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
            Faltan datos
          </span>
        )}
      </button>
      {isOpen && (
        <PrescriberProfileModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onSaved={(profile) => setIsComplete(missingPrescriberItems(profile).length === 0)}
        />
      )}
    </>
  );
};
