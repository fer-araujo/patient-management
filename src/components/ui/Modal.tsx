import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

/**
 * Open modals, oldest first. They share one body scroll lock, so a modal
 * opened from another one (e.g. the DatePicker inside a form) does not unlock
 * the page when it closes; and Escape closes only the top-most one.
 */
interface OpenModal {
  close: () => void;
}
const openModals: OpenModal[] = [];
let bodyOverflowBeforeLock = "";

/** Bubble phase, so a field inside the modal can handle Escape first. */
const closeTopModalOnEscape = (e: KeyboardEvent) => {
  // Ignore Escape that cancels IME composition, or that a field inside the
  // modal (e.g. an open Dropdown) already handled.
  if (e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
  const top = openModals[openModals.length - 1];
  if (!top) return;
  e.preventDefault();
  top.close();
};

const pushOpenModal = (modal: OpenModal) => {
  if (openModals.length === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeTopModalOnEscape);
  }
  openModals.push(modal);
};

const removeOpenModal = (modal: OpenModal) => {
  const index = openModals.indexOf(modal);
  if (index === -1) return;
  openModals.splice(index, 1);
  if (openModals.length === 0) {
    document.body.style.overflow = bodyOverflowBeforeLock;
    document.removeEventListener("keydown", closeTopModalOnEscape);
  }
};

interface VisibleArea {
  top: number;
  height: number;
}

/**
 * The part of the screen not covered by the iOS keyboard, while it is open.
 * iPad Safari shrinks the visual viewport (not the layout one) for the
 * keyboard, so a modal centred on the layout viewport ends up under it.
 * Returns null when nothing covers the page.
 */
const useKeyboardSafeArea = (active: boolean): VisibleArea | null => {
  const [area, setArea] = useState<VisibleArea | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;

    const update = () => {
      const covered = window.innerHeight - viewport.height > 1;
      setArea(
        covered ? { top: viewport.offsetTop, height: viewport.height } : null,
      );
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setArea(null);
    };
  }, [active]);

  return area;
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  hideFooter?: boolean;
  children: ReactNode;
  maxWidth?: string;
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  icon,
  hideFooter = false,
  maxWidth = "max-w-2xl",
  children,
}: ModalProps) => {
  // Latest onClose, so the stack entry stays the same while the modal is open.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const entry: OpenModal = { close: () => onCloseRef.current() };
    pushOpenModal(entry);
    return () => removeOpenModal(entry);
  }, [isOpen]);

  const keyboardSafeArea = useKeyboardSafeArea(isOpen);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 max-md:px-2 sm:px-6"
          style={
            keyboardSafeArea
              ? {
                  top: keyboardSafeArea.top,
                  height: keyboardSafeArea.height,
                  bottom: "auto",
                }
              : undefined
          }
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-brand-dark/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            // APLICAMOS EL ANCHO DINÁMICO AQUÍ:
            // Portrait phones (max-md) get nearly the whole screen, so forms
            // need less scrolling. Landscape phones are wider than md and use
            // the tablet layout; only the max-height:500px rule gives them
            // nearly the whole (short) screen height.
            className={`relative w-full ${maxWidth} bg-white rounded-4xl max-md:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] supports-[height:1dvh]:max-h-[85dvh] max-md:max-h-[94vh] max-md:supports-[height:1dvh]:max-h-[94dvh] [@media(max-height:500px)]:max-h-[94vh] [@media(max-height:500px)]:supports-[height:1dvh]:max-h-[94dvh]`}
            style={
              keyboardSafeArea
                ? { maxHeight: keyboardSafeArea.height - 16 }
                : undefined
            }
          >
            <div className="px-6 max-md:px-4 py-4 max-md:py-3 border-b border-brand-light flex items-center justify-between gap-3 bg-slate-50 sticky top-0 z-10 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {icon}
                <h3 className="text-xl max-md:text-lg font-bold text-brand-dark leading-tight">
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ventana"
                className="w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 shrink-0 flex items-center justify-center rounded-full bg-brand-light/50 text-brand-gray hover:bg-brand-light hover:text-brand-dark transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 max-md:px-4 py-6 max-md:py-5 overflow-y-auto overscroll-contain text-sm text-brand-gray leading-relaxed space-y-5">
              {children}
            </div>

            {!hideFooter && (
              <div className="px-6 max-md:px-4 py-4 border-t border-brand-light bg-slate-50 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-brand-primary cursor-pointer text-white font-bold px-8 py-2.5 max-md:w-full max-md:min-h-11 rounded-xl hover:bg-teal-500 transition-colors shadow-md"
                >
                  Entendido
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
