import { useState, useRef, useEffect } from "react";
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
}

export const Dropdown = ({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  searchable = false,
  className = "",
}: DropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const buttonRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Estado para guardar las coordenadas exactas del botón en la pantalla
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  const selectedOption = options.find((opt) => opt.value === value);

  // Función para calcular dónde debe aparecer el menú flotante
  const updateCoords = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY, // Se posiciona justo debajo del botón
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  };

  // Abrir el menú y calcular coordenadas
  const handleToggle = () => {
    if (!isOpen) updateCoords();
    setIsOpen(!isOpen);
  };

  // Cerrar al hacer clic afuera (escuchamos tanto el botón como el portal)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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

    // Actualizar coordenadas si hacen scroll o resize para que el menú no se despegue
    const handleScrollOrResize = () => {
      if (isOpen) updateCoords();
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScrollOrResize, true); // true para atrapar scrolls anidados
      window.addEventListener("resize", handleScrollOrResize);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [isOpen]);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <>
      {/* Botón Trigger (Sigue viviendo dentro del Modal normal) */}
      <div className={`relative ${className}`} ref={buttonRef}>
        <div
          onClick={handleToggle}
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
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: "absolute",
                  top: `${coords.top + 8}px`, // +8px de margen
                  left: `${coords.left}px`,
                  width: `${coords.width}px`,
                  zIndex: 999999, // Ahora sí, el z-index reinará supremo sobre todo el body
                }}
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
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 border-none rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-primary/30"
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  </div>
                )}

                <div className="max-h-60 overflow-y-auto p-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
                  {filteredOptions.length === 0 ? (
                    <div className="p-3 text-sm text-brand-gray text-center">
                      No hay resultados
                    </div>
                  ) : (
                    filteredOptions.map((opt) => (
                      <div
                        key={opt.value}
                        onClick={() => {
                          if (opt.disabled) return;
                          onChange(opt.value);
                          setIsOpen(false);
                          setSearchTerm("");
                        }}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
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
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
};
