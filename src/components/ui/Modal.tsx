import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  icon,
  children,
}: ModalProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6">
          {/* Fondo oscuro con blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-brand-dark/40 backdrop-blur-sm"
          />

          {/* Contenedor del Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-white rounded-4xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            {/* Header Fijo */}
            <div className="px-6 py-4 border-b border-brand-light flex items-center justify-between bg-slate-50 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                {icon}
                <h3 className="text-xl font-bold text-brand-dark">{title}</h3>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-brand-light/50 text-brand-gray hover:bg-brand-light hover:text-brand-dark transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Contenido scrolleable */}
            <div className="px-6 py-6 overflow-y-auto text-sm text-brand-gray leading-relaxed space-y-5">
              {children}
            </div>

            {/* Footer Fijo */}
            <div className="px-6 py-4 border-t border-brand-light bg-slate-50 flex justify-end">
              <button
                onClick={onClose}
                className="bg-brand-primary cursor-pointer text-white font-bold px-8 py-2.5 rounded-full hover:bg-teal-500 transition-colors shadow-md"
              >
                Entendido
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
