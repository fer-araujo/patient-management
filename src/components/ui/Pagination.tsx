import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange?: (items: number) => void; // <-- NUEVA PROP
  variant?: "table" | "list";
}

export const Pagination = ({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  variant = "table",
}: PaginationProps) => {
  if (totalItems === 0) return null;

  const startIndex = (currentPage - 1) * itemsPerPage + 1;
  const endIndex = Math.min(currentPage * itemsPerPage, totalItems);

  const containerClasses =
    variant === "table"
      ? "flex flex-col sm:flex-row items-center justify-between px-6 max-md:px-3 py-4 border-t border-slate-100 bg-white/50 gap-4 sm:gap-0"
      : "flex flex-col sm:flex-row items-center justify-center gap-4 py-6";

  const renderPageNumbers = () => {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= currentPage - 1 && i <= currentPage + 1)
      ) {
        pages.push(
          <button
            type="button"
            key={i}
            onClick={() => onPageChange(i)}
            aria-label={`Página ${i}`}
            aria-current={currentPage === i ? "page" : undefined}
            className={`w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-lg text-sm font-bold transition-colors cursor-pointer ${
              currentPage === i
                ? "bg-brand-primary text-white shadow-sm"
                : "text-brand-gray hover:bg-slate-100 hover:text-brand-dark"
            }`}
          >
            {i}
          </button>,
        );
      } else if (
        (i === currentPage - 2 && currentPage > 3) ||
        (i === currentPage + 2 && currentPage < totalPages - 2)
      ) {
        pages.push(
          <span key={i} className="text-slate-400 px-1 max-md:px-0">
            ...
          </span>,
        );
      }
    }
    return pages;
  };

  return (
    <div className={containerClasses}>
      {variant === "table" && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <p className="text-sm text-brand-gray font-medium">
            Mostrando{" "}
            <span className="font-bold text-brand-dark">{startIndex}</span> a{" "}
            <span className="font-bold text-brand-dark">{endIndex}</span> de{" "}
            <span className="font-bold text-brand-dark">{totalItems}</span>
          </p>

          {/* EL NUEVO SELECTOR DE FILAS */}
          {onItemsPerPageChange && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-brand-gray font-medium">
                Filas:
              </span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  onItemsPerPageChange(Number(e.target.value));
                  onPageChange(1); // Regresamos a la pag 1 al cambiar el tamaño
                }}
                aria-label="Filas por página"
                className="bg-white border border-slate-200 text-brand-dark text-sm font-bold rounded-lg focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none cursor-pointer px-2 py-1 pointer-coarse:min-h-11 pointer-coarse:px-3 transition-all"
              >
                {[5, 10, 15, 25, 30].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Phones: 44 px touch buttons only fit 440 px without the gaps. */}
      <div className="flex items-center gap-1 max-md:gap-0.5">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Página anterior"
          className="w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-lg text-brand-gray hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1 max-md:gap-0.5">
          {renderPageNumbers()}
        </div>

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Página siguiente"
          className="w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-lg text-brand-gray hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
