import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import type {
  ProcedureProfit,
  ProcedureProfitSummary,
} from "../../../../lib/services/financeService";
import { formatMXN } from "../../../../lib/services/inventoryService";

interface TableRow extends Omit<ProcedureProfit, "serviceId" | "service"> {
  key: string;
  label: string;
  isTotal: boolean;
}

/** One row per service plus a "Total" row (none when the period is empty). */
const buildRows = ({ rows, total }: ProcedureProfitSummary): TableRow[] =>
  rows.length === 0
    ? []
    : [
        ...rows.map((r) => ({
          ...r,
          key: r.serviceId ?? "none",
          label: r.service,
          isTotal: false,
        })),
        { ...total, key: "total", label: "Total", isTotal: true },
      ];

// Same cell styles as FinanceTable.
const textClasses = (row: TableRow, negative = false) =>
  `text-sm ${row.isTotal ? "font-black" : "font-bold"} ${negative ? "text-rose-600" : "text-brand-dark"}`;

const moneyColumn = (
  header: string,
  pick: (r: TableRow) => number,
  signed = false,
): ColumnDef<TableRow> => ({
  header,
  className: "text-right",
  cell: (row) => {
    const value = pick(row);
    return (
      <span className={textClasses(row, signed && value < 0)}>
        {value === 0 ? "—" : formatMXN(value)}
      </span>
    );
  },
});

const COLUMNS: ColumnDef<TableRow>[] = [
  {
    header: "Servicio",
    cell: (row) => (
      <span className={textClasses(row)}>
        {row.label}
        {!row.isTotal && row.uncostedSupplies > 0 && " *"}
      </span>
    ),
  },
  {
    header: "Veces",
    className: "text-right",
    cell: (row) => <span className={textClasses(row)}>{row.times}</span>,
  },
  moneyColumn("Cobrado", (r) => r.charged),
  moneyColumn("Cortesías", (r) => r.courtesyValue),
  moneyColumn("Insumos", (r) => r.suppliesCost),
  moneyColumn("Ganancia", (r) => r.profit, true),
];

interface Props {
  summary: ProcedureProfitSummary;
}

/** "Ganancia por procedimiento": charged vs. supplies used, per service. */
export const ProcedureProfitTable = ({ summary }: Props) => (
  <div className="-mx-6">
    <DataGrid
      data={buildRows(summary)}
      columns={COLUMNS}
      keyExtractor={(row) => row.key}
      emptyState={
        <div className="text-center text-brand-gray font-medium">
          No hay consultas cobradas en este periodo.
        </div>
      }
    />
  </div>
);
