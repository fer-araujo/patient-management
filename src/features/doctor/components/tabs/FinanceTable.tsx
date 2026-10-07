import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import {
  monthLabels,
  type MonthlyFinance,
} from "../../../../lib/services/financeService";
import { formatMXN } from "../../../../lib/services/inventoryService";
import { COURTESY_COLOR, EXPENSES_COLOR, INCOME_COLOR } from "./financeColors";

interface TableRow {
  key: string;
  label: string;
  income: number;
  courtesy: number;
  expenses: number;
  /** Income minus supply spending. Courtesies never reduce it. */
  profit: number;
  isTotal: boolean;
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

/** One row per month plus a "Total" row. */
const buildFinanceTableRows = (data: MonthlyFinance[]): TableRow[] => {
  const months = data.map((d) => ({
    key: d.month,
    label: monthLabels(d.month).fullLabel,
    income: d.income,
    courtesy: d.courtesy,
    expenses: d.expenses,
    profit: roundCents(d.income - d.expenses),
    isTotal: false,
  }));
  const sum = (pick: (r: TableRow) => number) =>
    roundCents(months.reduce((acc, r) => acc + pick(r), 0));
  const income = sum((r) => r.income);
  const expenses = sum((r) => r.expenses);
  return [
    ...months,
    {
      key: "total",
      label: "Total",
      income,
      courtesy: sum((r) => r.courtesy),
      expenses,
      profit: roundCents(income - expenses),
      isTotal: true,
    },
  ];
};

const textClasses = (row: TableRow, negative = false) =>
  `text-sm ${row.isTotal ? "font-black" : "font-bold"} ${negative ? "text-rose-600" : "text-brand-dark"}`;

const moneyColumn = (
  header: string,
  pick: (r: TableRow) => number,
  options: { signed?: boolean; color?: string } = {},
): ColumnDef<TableRow> => ({
  mobileLabel: header,
  // A dot in the series color ties the column to its bar in the chart; the
  // numbers themselves stay in text ink.
  header: options.color ? (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: options.color }}
      />
      {header}
    </span>
  ) : (
    header
  ),
  className: "text-right",
  cell: (row) => {
    const value = pick(row);
    // A dash instead of $0.00 keeps empty months from burying the ones with data.
    return (
      <span className={textClasses(row, options.signed === true && value < 0)}>
        {value === 0 ? "—" : formatMXN(value)}
      </span>
    );
  },
});

const COLUMNS: ColumnDef<TableRow>[] = [
  {
    header: "Mes",
    mobileRole: "title",
    cell: (row) => <span className={textClasses(row)}>{row.label}</span>,
  },
  moneyColumn("Ingresos", (r) => r.income, { color: INCOME_COLOR }),
  moneyColumn("Cortesías", (r) => r.courtesy, { color: COURTESY_COLOR }),
  moneyColumn("Gastos", (r) => r.expenses, { color: EXPENSES_COLOR }),
  {
    ...moneyColumn("Ganancia", (r) => r.profit, { signed: true }),
    mobileRole: "status",
  },
];

interface Props {
  data: MonthlyFinance[];
}

/** The chart's values as a table: the "Tabla" view of the chart card. */
export const FinanceTable = ({ data }: Props) => (
  <div className="-mx-6 max-md:-mx-4">
    <DataGrid
      data={buildFinanceTableRows(data)}
      columns={COLUMNS}
      keyExtractor={(row) => row.key}
    />
  </div>
);
