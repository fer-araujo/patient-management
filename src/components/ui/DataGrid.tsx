import {
  type ReactNode,
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useId,
} from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ArrowUpNarrowWide,
  ArrowDownWideNarrow,
} from "lucide-react";
import { Pagination } from "./Pagination";
import { Dropdown } from "./Dropdown";
import { useIsPhone } from "./useIsPhone";

/**
 * Where a column goes when the grid renders each row as a card (phones,
 * below 768 px):
 * - `title`: the main line (patient, item), large and bold.
 * - `subtitle`: smaller lines under the title.
 * - `status`: top-right corner, next to the title (status pills).
 * - `meta`: labelled values in a two-column grid ("Teléfono", "Fecha").
 * - `actions`: buttons at the bottom of the card; they wrap and grow to share
 *   the width.
 * - `hidden`: not shown on phones.
 *
 * Without it, the first column is the title, a `stickyRight` column holds the
 * actions and every other column is a `meta` line.
 */
export type MobileRole =
  | "title"
  | "subtitle"
  | "meta"
  | "status"
  | "actions"
  | "hidden";

export interface ColumnDef<T> {
  header: string | ReactNode;
  accessorKey?: keyof T;
  cell?: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
  /**
   * Keeps this column pinned to the right edge while the table scrolls
   * sideways (below 1280 px, e.g. an iPad in portrait), so row actions are
   * always reachable. Meant for the last column.
   */
  stickyRight?: boolean;
  /** Placement in the phone card layout; see `MobileRole`. */
  mobileRole?: MobileRole;
  /**
   * Label for the column on phones (`meta` lines and the "Ordenar por" list).
   * Defaults to the header when the header is plain text.
   */
  mobileLabel?: string;
  /** A `meta` line that needs the whole card width (long text). */
  mobileWide?: boolean;
}

/** Pinned-column classes; only below xl, so wide screens look unchanged. */
const STICKY_RIGHT_CLASSES =
  "max-xl:sticky max-xl:right-0 max-xl:z-1 max-xl:bg-white";
/** Edge shadow telling that more columns hide under the pinned one. */
const STICKY_SHADOW_CLASSES =
  "max-xl:shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]";

const resolveMobileRole = <T,>(
  col: ColumnDef<T>,
  index: number,
): MobileRole => {
  if (col.mobileRole) return col.mobileRole;
  if (col.stickyRight) return "actions";
  return index === 0 ? "title" : "meta";
};

const mobileLabelOf = <T,>(col: ColumnDef<T>): string =>
  col.mobileLabel ??
  (typeof col.header === "string"
    ? col.header
    : String(col.accessorKey ?? ""));

const renderCell = <T,>(col: ColumnDef<T>, row: T): ReactNode =>
  col.cell
    ? col.cell(row)
    : col.accessorKey
      ? (row[col.accessorKey] as ReactNode)
      : null;

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
  // Phones get one card per row instead of a wide table.
  const isPhone = useIsPhone();
  const sortLabelId = useId();

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

  // Whether the table is cut off on the right, to hint that it scrolls.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const updateScrollHint = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateScrollHint();
    el.addEventListener("scroll", updateScrollHint, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollHint);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollHint);
      observer?.disconnect();
    };
  }, [updateScrollHint, paginatedData, isPhone]);

  const hasStickyColumn = columns.some((col) => col.stickyRight);
  const stickyClasses = (col: ColumnDef<T>) =>
    col.stickyRight
      ? `${STICKY_RIGHT_CLASSES} ${canScrollRight ? STICKY_SHADOW_CLASSES : ""}`
      : "";

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

  const defaultEmptyState = (
    <div className="text-center text-brand-gray font-medium">
      No hay datos disponibles.
    </div>
  );

  const pagination = currentItemsPerPage && sortedData.length > 0 && (
    <Pagination
      variant="table"
      currentPage={currentPage}
      totalPages={totalPages}
      totalItems={sortedData.length}
      itemsPerPage={currentItemsPerPage}
      onPageChange={setCurrentPage}
      onItemsPerPageChange={setCurrentItemsPerPage}
    />
  );

  if (isPhone) {
    const withRoles = columns.map((col, index) => ({
      col,
      index,
      role: resolveMobileRole(col, index),
    }));
    const byRole = (role: MobileRole) =>
      withRoles.filter((entry) => entry.role === role);
    const titles = byRole("title");
    const subtitles = byRole("subtitle");
    const statuses = byRole("status");
    const metas = byRole("meta");
    const actions = byRole("actions");
    const sortableColumns = columns.filter(
      (col) => col.sortable && col.accessorKey,
    );

    return (
      <div className="w-full flex flex-col" data-testid="data-grid-cards">
        {/* Column headers are gone on phones, so sorting moves here. */}
        {sortableColumns.length > 0 && sortedData.length > 1 && (
          <div className="flex items-end gap-2 px-4 pt-4 pb-3 border-b border-slate-100">
            <div className="flex-1 min-w-0">
              <span
                id={sortLabelId}
                className="block text-xs font-bold text-brand-gray uppercase tracking-wider mb-1"
              >
                Ordenar por
              </span>
              <Dropdown
                labelledBy={sortLabelId}
                value={sortConfig ? String(sortConfig.key) : ""}
                onChange={(value) =>
                  setSortConfig(
                    value ? { key: value as keyof T, direction: "asc" } : null,
                  )
                }
                options={[
                  { label: "Orden original", value: "" },
                  ...sortableColumns.map((col) => ({
                    label: mobileLabelOf(col),
                    value: String(col.accessorKey),
                  })),
                ]}
              />
            </div>
            <button
              type="button"
              disabled={!sortConfig}
              onClick={() =>
                sortConfig &&
                setSortConfig({
                  key: sortConfig.key,
                  direction: sortConfig.direction === "asc" ? "desc" : "asc",
                })
              }
              aria-label={
                sortConfig?.direction === "desc"
                  ? "Orden descendente, cambiar a ascendente"
                  : "Orden ascendente, cambiar a descendente"
              }
              className="flex items-center justify-center gap-1.5 min-h-11.5 px-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-brand-dark disabled:opacity-40 cursor-pointer shrink-0"
            >
              {sortConfig?.direction === "desc" ? (
                <ArrowDownWideNarrow className="w-5 h-5" aria-hidden="true" />
              ) : (
                <ArrowUpNarrowWide className="w-5 h-5" aria-hidden="true" />
              )}
              {sortConfig?.direction === "desc" ? "Desc." : "Asc."}
            </button>
          </div>
        )}

        {paginatedData.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {paginatedData.map((row) => (
              <li
                key={keyExtractor(row)}
                data-testid="data-grid-card"
                className="px-4 py-4 bg-white"
              >
                {(titles.length > 0 ||
                  subtitles.length > 0 ||
                  statuses.length > 0) && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1 wrap-break-word">
                      {titles.map(({ col, index }) => (
                        <div
                          key={index}
                          className="text-base font-bold text-brand-dark"
                        >
                          {renderCell(col, row)}
                        </div>
                      ))}
                      {subtitles.map(({ col, index }) => (
                        <div key={index} className="text-sm text-brand-gray">
                          {renderCell(col, row)}
                        </div>
                      ))}
                    </div>
                    {statuses.length > 0 && (
                      <div className="shrink-0 max-w-[45%] flex flex-col items-end gap-1.5 text-right">
                        {statuses.map(({ col, index }) => (
                          <div key={index}>{renderCell(col, row)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {metas.length > 0 && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    {metas.map(({ col, index }) => (
                      <div
                        key={index}
                        className={`min-w-0 wrap-break-word ${col.mobileWide ? "col-span-2" : ""}`}
                      >
                        <dt className="text-xs font-bold text-brand-gray uppercase tracking-wider mb-0.5">
                          {mobileLabelOf(col)}
                        </dt>
                        <dd className="text-brand-dark font-medium">
                          {renderCell(col, row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {actions.length > 0 && (
                  // Action cells are built for a table cell (a right-aligned
                  // row of buttons). Here they wrap from the left and the
                  // buttons grow to share the card width.
                  <div
                    data-testid="data-grid-card-actions"
                    className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-2 [&>div>*]:flex-wrap [&>div>*]:justify-start [&>div>*]:w-full [&_button]:grow [&_button]:min-h-11"
                  >
                    {actions.map(({ col, index }) => (
                      <div key={index} className="flex">
                        {renderCell(col, row)}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-12">{emptyState || defaultEmptyState}</div>
        )}

        {pagination}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col">
      <div className="relative w-full">
        <div
          ref={scrollerRef}
          data-testid="data-grid-scroller"
          data-can-scroll-right={canScrollRight || undefined}
          className="w-full overflow-x-auto max-xl:overscroll-x-contain"
        >
          <table className="w-full text-left border-collapse min-w-200">
            <thead>
              <tr className="border-b border-slate-100 bg-white">
                {columns.map((col, index) => (
                  <th
                    key={index}
                    className={`px-6 py-4 text-xs font-bold text-brand-gray uppercase tracking-wider ${stickyClasses(col)} ${col.className || ""}`}
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
                        className={`px-6 py-4 align-middle ${stickyClasses(col)} ${col.className || ""}`}
                      >
                        {renderCell(col, row)}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-16">
                    {emptyState || defaultEmptyState}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Without a pinned column, a soft fade on the right edge says "more
            columns this way" when the table is wider than the screen. */}
        {!hasStickyColumn && canScrollRight && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-10 xl:hidden bg-linear-to-l from-white to-transparent"
          />
        )}
      </div>

      {/* RENDERIZADO DE LA PAGINACIÓN */}
      {pagination}
    </div>
  );
}
