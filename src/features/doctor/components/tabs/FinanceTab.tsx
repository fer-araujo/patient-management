import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Gift,
  Loader2,
  PiggyBank,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import toast from "react-hot-toast";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import {
  getFinanceSummary,
  getPeriodRange,
  type FinanceMovement,
  type FinancePeriod,
  type FinanceSummary,
  type MonthlyFinance,
} from "../../../../lib/services/financeService";
import { formatMXN } from "../../../../lib/services/inventoryService";
import { FinanceChart } from "./FinanceChart";
import { FinanceTable } from "./FinanceTable";

type ChartView = "chart" | "table";

const PERIOD_OPTIONS: { label: string; value: FinancePeriod }[] = [
  { label: "Este mes", value: "this_month" },
  { label: "Mes pasado", value: "last_month" },
  { label: "Este año", value: "this_year" },
];

const KIND_LABELS: Record<FinanceMovement["kind"], string> = {
  payment: "Cobro",
  courtesy: "Cortesía",
  purchase: "Compra",
};

const formatSigned = (amount: number) =>
  amount > 0 ? `+${formatMXN(amount)}` : formatMXN(amount);

const formatDay = (timestamp: string) =>
  new Date(timestamp)
    .toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .replace(/\./g, "");

interface FinanceTabProps {
  /**
   * Show the patient's name next to each charge. Only for the doctor; an admin
   * sees the amount and the service, never who was treated.
   */
  showPatientNames?: boolean;
}

export const FinanceTab = ({ showPatientNames = false }: FinanceTabProps) => {
  const [period, setPeriod] = useState<FinancePeriod>("this_month");
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [monthly, setMonthly] = useState<MonthlyFinance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<ChartView>("chart");

  useEffect(() => {
    let cancelled = false;
    const range = getPeriodRange(period);
    // The chart always shows the months of the period's year up to the period
    // end, so a single month is still seen next to the ones before it.
    const chartFrom = `${range.from.slice(0, 4)}-01-01`;

    Promise.all([
      getFinanceSummary(range.from, range.to, {
        includePatientNames: showPatientNames,
      }),
      // Only its monthly totals are used, so no names are ever requested.
      chartFrom === range.from
        ? null
        : getFinanceSummary(chartFrom, range.to),
    ])
      .then(([periodSummary, chartSummary]) => {
        if (cancelled) return;
        setSummary(periodSummary);
        setMonthly((chartSummary ?? periodSummary).monthly);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[FinanceTab] Error al cargar las finanzas:", error);
        toast.error("Error al cargar las finanzas");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period, showPatientNames]);

  const handlePeriodChange = (value: string) => {
    if (value === period) return;
    setIsLoading(true);
    setPeriod(value as FinancePeriod);
  };

  const columns: ColumnDef<FinanceMovement>[] = [
    {
      header: "Fecha",
      accessorKey: "date",
      sortable: true,
      className: "w-[20%]",
      cell: (row) => (
        <span className="text-sm font-bold text-brand-dark">
          {formatDay(row.date)}
        </span>
      ),
    },
    {
      header: "Concepto",
      className: "w-[55%]",
      cell: (row) => (
        <div className="flex flex-col items-start">
          <span className="font-bold text-sm text-brand-dark">
            {row.concept}
          </span>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md mt-1 uppercase tracking-wider">
            {KIND_LABELS[row.kind]}
          </span>
        </div>
      ),
    },
    {
      header: "Monto",
      accessorKey: "amount",
      sortable: true,
      className: "w-[25%] text-right",
      cell: (row) => (
        <span
          className={`text-sm font-bold ${row.amount < 0 ? "text-rose-600" : "text-brand-dark"}`}
        >
          {formatSigned(row.amount)}
        </span>
      ),
    },
  ];

  const periodSelector = (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
      <Dropdown
        className="w-full sm:w-40"
        value={period}
        onChange={handlePeriodChange}
        options={PERIOD_OPTIONS}
      />
    </div>
  );

  if (isLoading || !summary) {
    return (
      <div className="space-y-6">
        {periodSelector}
        <div className="py-20 flex flex-col items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
          <p className="text-brand-gray font-medium">Cargando finanzas...</p>
        </div>
      </div>
    );
  }

  const isLoss = summary.profit < 0;

  // Same look as the choice buttons in PurchaseModal, in a compact size.
  const choiceClasses = (selected: boolean) =>
    `rounded-xl border-2 px-3 py-1.5 text-sm font-bold transition-all cursor-pointer ${
      selected
        ? "border-brand-primary bg-brand-light/40 text-brand-dark"
        : "border-brand-light bg-white text-brand-gray hover:border-brand-primary/40"
    }`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {periodSelector}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 xl:gap-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <TrendingUp className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Ingresos
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {formatMXN(summary.income)}
            </h4>
            <p className="text-xs text-brand-gray mt-1">Cobros de consultas</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          {/* Icon tint = the series color in the chart (the number stays ink). */}
          <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center shrink-0">
            <ShoppingCart className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Gastos
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {formatMXN(summary.expenses)}
            </h4>
            <p className="text-xs text-brand-gray mt-1">Compras de insumos</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <PiggyBank className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Ganancia
            </p>
            <h4
              className={`text-3xl font-black leading-none ${isLoss ? "text-rose-600" : "text-brand-dark"}`}
            >
              {formatMXN(summary.profit)}
            </h4>
            <p className="text-xs text-brand-gray mt-1">
              {isLoss ? "Gastaste más de lo que cobraste" : "Ingresos menos gastos"}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
          <div className="w-14 h-14 bg-[#9edfd6]/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <Gift className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Cortesías
            </p>
            <h4 className="text-3xl font-black text-brand-dark leading-none">
              {summary.courtesyCount}
            </h4>
            <p className="text-xs text-brand-gray mt-1">
              Valor no cobrado: {formatMXN(summary.forgoneValue)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm font-bold text-brand-gray uppercase tracking-wider">
            Ingresos y gastos por mes
          </p>
          <div
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label="Ver como"
          >
            <button
              type="button"
              role="radio"
              aria-checked={view === "chart"}
              onClick={() => setView("chart")}
              className={choiceClasses(view === "chart")}
            >
              Gráfica
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={view === "table"}
              onClick={() => setView("table")}
              className={choiceClasses(view === "table")}
            >
              Tabla
            </button>
          </div>
        </div>
        {view === "chart" ? (
          <FinanceChart data={monthly} />
        ) : (
          <FinanceTable data={monthly} />
        )}
      </div>

      <div className="space-y-4">
        <p className="text-sm font-bold text-brand-gray uppercase tracking-wider">
          Movimientos recientes
        </p>
        <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <DataGrid
            data={summary.movements}
            columns={columns}
            keyExtractor={(row) => `${row.kind}-${row.id}`}
            itemsPerPage={10}
          />
        </div>
      </div>
    </motion.div>
  );
};
