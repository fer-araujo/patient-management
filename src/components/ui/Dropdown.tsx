import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, Check } from "lucide-react";

interface Option {
  label: string;
  value: string;
  disabled?: boolean;
}

interface DropdownProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  /** id of the visible label, so the trigger and its list get an accessible name. */
  labelledBy?: string;
}

/** Tailwind `max-h-60`: the list's height when there is room. */
const LIST_MAX_HEIGHT = 240;
/** Smallest list worth showing when the keyboard eats the screen. */
const LIST_MIN_HEIGHT = 120;
/** Search box row plus the list's own padding. */
const SEARCH_ROW_HEIGHT = 57;
const LIST_PADDING = 8;
/** Gap between trigger and menu, and between menu and the screen edge. */
const MENU_GAP = 8;

interface MenuCoords {
  top: number;
  left: number;
  width: number;
  placement: "below" | "above";
  listMaxHeight: number;
}

/**
 * Places the menu below the trigger, or above it when it does not fit below
 * and there is more room above (e.g. a field near the bottom of an iPad
 * screen, or with the on-screen keyboard open). Measures the visual viewport
 * because iOS shrinks it, not the layout viewport, when the keyboard shows.
 */
const computeMenuCoords = (
  rect: DOMRect,
  searchable: boolean,
): MenuCoords => {
  const viewport = window.visualViewport;
  const viewTop = viewport?.offsetTop ?? 0;
  const viewBottom = viewTop + (viewport?.height ?? window.innerHeight);

  const chrome = (searchable ? SEARCH_ROW_HEIGHT : 0) + LIST_PADDING;
  const needed = LIST_MAX_HEIGHT + chrome + MENU_GAP * 2;
  const spaceBelow = viewBottom - rect.bottom;
  const spaceAbove = rect.top - viewTop;
  const placement =
    spaceBelow < needed && spaceAbove > spaceBelow ? "above" : "below";
  const space = placement === "below" ? spaceBelow : spaceAbove;
  const listMaxHeight = Math.max(
    LIST_MIN_HEIGHT,
    Math.min(LIST_MAX_HEIGHT, space - chrome - MENU_GAP * 2),
  );

  return {
    top:
      placement === "below"
        ? rect.bottom + window.scrollY + MENU_GAP
        : rect.top + window.scrollY - MENU_GAP,
    left: rect.left + window.scrollX,
    width: rect.width,
    placement,
    listMaxHeight,
  };
};

/** True on touch screens (iPad), where focusing a field opens the keyboard. */
const isCoarsePointer = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches ?? false);

export const Dropdown = ({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  searchable = false,
  className = "",
  labelledBy,
}: DropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const buttonRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Where the floating menu goes, in document coordinates. `placement` says
  // whether it hangs below the trigger or sits above it (`top` is then the
  // menu's bottom edge, see the wrapper's translateY(-100%)).
  const [coords, setCoords] = useState<MenuCoords>({
    top: 0,
    left: 0,
    width: 0,
    placement: "below",
    listMaxHeight: LIST_MAX_HEIGHT,
  });

  const selectedOption = options.find((opt) => opt.value === value);

  const updateCoords = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setCoords(computeMenuCoords(rect, searchable));
  }, [searchable]);

  const handleToggle = () => {
    if (!isOpen) updateCoords();
    setIsOpen(!isOpen);
  };

  // Close on any outside press. `pointerdown` covers mouse, pen and touch;
  // iPad Safari does not reliably fire `mousedown` for taps on non-clickable
  // areas, so the menu used to stay open there.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    // Escape closes only the list. Capture phase on window runs before the
    // Modal's document listener, and stopping it keeps the modal underneath
    // open.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setSearchTerm("");
    };

    // Keep the menu glued to the trigger on scroll, resize and when the iOS
    // keyboard changes the visual viewport.
    const viewport = window.visualViewport;
    document.addEventListener("pointerdown", handlePointerDownOutside);
    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("scroll", updateCoords, true); // true para atrapar scrolls anidados
    window.addEventListener("resize", updateCoords);
    viewport?.addEventListener("resize", updateCoords);
    viewport?.addEventListener("scroll", updateCoords);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside);
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("scroll", updateCoords, true);
      window.removeEventListener("resize", updateCoords);
      viewport?.removeEventListener("resize", updateCoords);
      viewport?.removeEventListener("scroll", updateCoords);
    };
  }, [isOpen, updateCoords]);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <>
      {/* Botón Trigger (Sigue viviendo dentro del Modal normal) */}
      <div className={`relative ${className}`} ref={buttonRef}>
        <div
          onClick={handleToggle}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={labelledBy}
          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium flex items-center justify-between cursor-pointer focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/20 transition-all"
        >
          <span
            className={
              selectedOption ? "text-brand-dark font-bold" : "text-brand-gray"
            }
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-brand-gray transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </div>
      </div>

      {/* Menú Desplegable (PORTALIZADO: Se inyecta directo en el body) */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              // Outer box positions; the inner one animates. Kept apart so
              // framer-motion's transform does not overwrite translateY(-100%).
              <div
                key="dropdown-menu"
                ref={menuRef}
                data-placement={coords.placement}
                style={{
                  position: "absolute",
                  top: `${coords.top}px`,
                  left: `${coords.left}px`,
                  width: `${coords.width}px`,
                  transform:
                    coords.placement === "above"
                      ? "translateY(-100%)"
                      : undefined,
                  zIndex: 999999, // Ahora sí, el z-index reinará supremo sobre todo el body
                }}
              >
                <motion.div
                  initial={{
                    opacity: 0,
                    y: coords.placement === "above" ? 10 : -10,
                  }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    y: coords.placement === "above" ? 10 : -10,
                  }}
                  transition={{ duration: 0.15 }}
                  className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
                >
                  {searchable && (
                    <div className="p-2 border-b border-slate-100 relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Buscar..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 bg-slate-50 border-none rounded-lg text-base focus:outline-none focus:ring-1 focus:ring-brand-primary/30"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Buscar opción"
                        // On iPad, focusing opens the keyboard over the list.
                        autoFocus={!isCoarsePointer()}
                      />
                    </div>
                  )}

                  <div
                    role="listbox"
                    aria-labelledby={labelledBy}
                    style={{ maxHeight: `${coords.listMaxHeight}px` }}
                    className="overflow-y-auto overscroll-contain p-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
                    {filteredOptions.length === 0 ? (
                      <div className="p-3 text-sm text-brand-gray text-center">
                        No hay resultados
                      </div>
                    ) : (
                      filteredOptions.map((opt) => (
                        <div
                          key={opt.value}
                          role="option"
                          aria-selected={value === opt.value}
                          aria-disabled={opt.disabled || undefined}
                          onClick={() => {
                            if (opt.disabled) return;
                            onChange(opt.value);
                            setIsOpen(false);
                            setSearchTerm("");
                          }}
                          className={`flex items-center justify-between px-3 py-2.5 pointer-coarse:min-h-11 rounded-lg text-sm transition-colors ${
                            opt.disabled
                              ? "opacity-50 cursor-not-allowed bg-slate-50 text-slate-500"
                              : "cursor-pointer hover:bg-brand-light/30 hover:text-brand-primary"
                          } ${value === opt.value ? "bg-brand-light/30 text-brand-primary font-bold" : "text-brand-dark"}`}
                        >
                          {opt.label}
                          {value === opt.value && <Check className="w-4 h-4" />}
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
};
