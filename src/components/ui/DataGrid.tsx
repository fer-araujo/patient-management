import { type ReactNode, useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Pagination } from "./Pagination";

export interface ColumnDef<T> {
  header: string | ReactNode;
  accessorKey?: keyof T;
  cell?: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
}

interface DataGridProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (row: T) => string | number;
  emptyState?: ReactNode;
  itemsPerPage?: number;
}

export function DataGrid<T>({
  data,
  columns,
  keyExtractor,
  emptyState,
  itemsPerPage: initialItemsPerPage,
}: DataGridProps<T>) {
  const [sortConfig, setSortConfig] = useState<{
    key: keyof T;
    direction: "asc" | "desc";
  } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);

  // NUEVO ESTADO: Manejamos las filas por página localmente
  const [currentItemsPerPage, setCurrentItemsPerPage] =
    useState(initialItemsPerPage);

  // LA CURA AL LINTER (Estado Derivado durante el render):
  // Guardamos la data anterior. Si la nueva data no es igual a la anterior (ej. filtraste),
  // reseteamos la página a 1 inmediatamente sin causar un doble render.
  const [prevData, setPrevData] = useState(data);
  if (data !== prevData) {
    setPrevData(data);
    setCurrentPage(1);
  }

  const sortedData = useMemo(() => {
    const sortableItems = [...data];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [data, sortConfig]);

  const paginatedData = useMemo(() => {
    if (!currentItemsPerPage) return sortedData;
    const startIndex = (currentPage - 1) * currentItemsPerPage;
    return sortedData.slice(startIndex, startIndex + currentItemsPerPage);
  }, [sortedData, currentPage, currentItemsPerPage]);

  const totalPages = currentItemsPerPage
    ? Math.ceil(sortedData.length / currentItemsPerPage)
    : 1;

  const handleSort = (key: keyof T) => {
    let direction: "asc" | "desc" = "asc";
    if (
      sortConfig &&
      sortConfig.key === key &&
      sortConfig.direction === "asc"
    ) {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  return (
    <div className="w-full flex flex-col">
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-200">
          <thead>
            <tr className="border-b border-slate-100 bg-white">
              {columns.map((col, index) => (
                <th
                  key={index}
                  className={`px-6 py-4 text-xs font-bold text-brand-gray uppercase tracking-wider ${col.className || ""}`}
                >
                  {col.sortable && col.accessorKey ? (
                    <button
                      onClick={() => handleSort(col.accessorKey as keyof T)}
                      className="flex items-center gap-1.5 hover:text-brand-dark transition-colors cursor-pointer group"
                    >
                      {col.header}
                      <span className="text-slate-300 group-hover:text-brand-primary">
                        {sortConfig?.key === col.accessorKey ? (
                          sortConfig.direction === "asc" ? (
                            <ChevronUp className="w-4 h-4 text-brand-primary" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-brand-primary" />
                          )
                        ) : (
                          <ChevronsUpDown className="w-4 h-4" />
                        )}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {paginatedData.length > 0 ? (
              paginatedData.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  className="hover:bg-slate-50/50 transition-colors group bg-white"
                >
                  {columns.map((col, colIndex) => (
                    <td
                      key={colIndex}
                      className={`px-6 py-4 align-middle ${col.className || ""}`}
                    >
                      {col.cell
                        ? col.cell(row)
                        : col.accessorKey
                          ? (row[col.accessorKey] as ReactNode)
                          : null}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-6 py-16">
                  {emptyState || (
                    <div className="text-center text-brand-gray font-medium">
                      No hay datos disponibles.
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* RENDERIZADO DE LA PAGINACIÓN */}
      {currentItemsPerPage && sortedData.length > 0 && (
        <Pagination
          variant="table"
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={sortedData.length}
          itemsPerPage={currentItemsPerPage}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={setCurrentItemsPerPage} // <-- Conectamos la nueva función
        />
      )}
    </div>
  );
}
