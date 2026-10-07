import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import {
  monthLabels,
  type MonthlyFinance,
} from "../../../../lib/services/financeService";
import { formatMXN } from "../../../../lib/services/inventoryService";
import { COURTESY_COLOR, EXPENSES_COLOR, INCOME_COLOR } from "./financeColors";
import { useIsPhone } from "../../../../components/ui/useIsPhone";

// SVG fills cannot read the Tailwind tokens, so the hex values live here
// (colors chosen by the owner for legibility on this doctor-only screen):
// income = --color-brand-primary; courtesies = a pastel of the same teal, so
// the stack reads as a faded continuation of the income bar; expenses =
// rose-400. The teal is under 3:1 contrast on white, so the legend, the
// tooltip and the "Tabla" view carry every value as text.
const TEXT_COLOR = "#5b5b5b"; // --color-brand-gray
const GRID_COLOR = "#f1f5f9"; // slate-100
const AXIS_COLOR = "#e2e8f0"; // slate-200

/**
 * Space left between the two stacked segments. Nothing is drawn there, so it
 * shows the card surface (bg-white) - a gap, not a border around the marks.
 */
const STACK_GAP = 2;
const CORNER = 4;

const SERIES = [
  { key: "income", label: "Ingresos", color: INCOME_COLOR },
  { key: "courtesy", label: "Cortesías (no cobrado)", color: COURTESY_COLOR },
  { key: "expenses", label: "Gastos", color: EXPENSES_COLOR },
] as const;

interface ChartRow extends MonthlyFinance {
  label: string;
  fullLabel: string;
}

/**
 * About `steps` round steps (1, 2, 2.5 or 5 × 10^n) from 0 up past `max`:
 * four on wide screens, three on a phone so the labels stay readable.
 */
const niceTicks = (max: number, steps = 4): number[] => {
  if (max <= 0) return [0];
  const raw = max / steps;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
};

/** Short axis ticks: $0, $500, $1.5k, $12k. */
const formatTick = (value: number) =>
  value >= 1000
    ? `$${(value / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 })}k`
    : `$${value.toLocaleString("es-MX")}`;

// -----------------------------------------------------------------------------
// Bar shapes: rounded only at the top end of each bar or stack, square at the
// baseline, and a surface-colored gap between the two stacked segments.
// -----------------------------------------------------------------------------

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: ChartRow;
}

const barPath = (x: number, y: number, w: number, h: number, r: number) => {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
};

const renderBar = (
  props: BarShapeProps,
  { gapAbove, rounded }: { gapAbove: boolean; rounded: boolean },
) => {
  const { x = 0, width = 0, fill } = props;
  let { y = 0, height = 0 } = props;
  if (gapAbove) {
    y += STACK_GAP;
    height -= STACK_GAP;
  }
  if (width <= 0 || height <= 0) return <g />;
  return <path d={barPath(x, y, width, height, rounded ? CORNER : 0)} fill={fill} />;
};

/** Bottom of the stack: flat top (and a gap) when a courtesy sits on it. */
const IncomeShape = (props: unknown) => {
  const p = props as BarShapeProps;
  const hasCourtesy = (p.payload?.courtesy ?? 0) > 0;
  return renderBar(p, { gapAbove: hasCourtesy, rounded: !hasCourtesy });
};

const TopShape = (props: unknown) =>
  renderBar(props as BarShapeProps, { gapAbove: false, rounded: true });

const FinanceTooltip = ({ active, payload }: TooltipContentProps) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload as ChartRow;
  // Courtesies are value not charged: they never reduce the profit.
  const profit = row.income - row.expenses;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-2xl px-4 py-3 space-y-1.5">
      <p className="text-sm font-bold text-brand-gray">{row.fullLabel}</p>
      {SERIES.map((s) => (
        <div key={s.key} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-3 h-0.5 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          <span className="text-base font-black text-brand-dark">
            {formatMXN(row[s.key])}
          </span>
          <span className="text-sm font-medium text-brand-gray">{s.label}</span>
        </div>
      ))}
      <p
        className={`text-sm font-bold pt-1.5 border-t border-slate-100 ${profit < 0 ? "text-rose-600" : "text-brand-dark"}`}
      >
        Ganancia: {formatMXN(profit)}
      </p>
    </div>
  );
};

interface Props {
  data: MonthlyFinance[];
}

/**
 * Per month: a stack of income (bottom) + courtesies (top) — together, what
 * could have been earned — beside a separate supply-spending bar.
 */
export const FinanceChart = ({ data }: Props) => {
  const isPhone = useIsPhone();
  const rows: ChartRow[] = data.map((d) => ({ ...d, ...monthLabels(d.month) }));
  const isEmpty = rows.every(
    (r) => r.income === 0 && r.courtesy === 0 && r.expenses === 0,
  );
  const ticks = niceTicks(
    Math.max(0, ...rows.map((r) => Math.max(r.income + r.courtesy, r.expenses))),
    isPhone ? 3 : 4,
  );

  return (
    <figure className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 max-md:gap-x-4 max-md:gap-y-2" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-2 text-sm font-bold text-brand-gray">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      {isEmpty ? (
        <div className="text-center text-brand-gray font-medium py-16">
          No hay ingresos ni gastos en este periodo.
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 8, right: isPhone ? 4 : 8, bottom: 0, left: 0 }}
              barGap={2}
              barCategoryGap="30%"
              title="Ingresos, cortesías y gastos por mes"
            >
              <CartesianGrid vertical={false} stroke={GRID_COLOR} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: AXIS_COLOR }}
                tick={{ fill: TEXT_COLOR, fontSize: isPhone ? 13 : 14, fontWeight: 700 }}
                tickMargin={8}
                // On a phone, skip labels evenly instead of leaving odd gaps.
                interval="equidistantPreserveStart"
              />
              <YAxis
                ticks={ticks}
                domain={[0, ticks[ticks.length - 1]]}
                tickFormatter={formatTick}
                tickLine={false}
                axisLine={false}
                tick={{ fill: TEXT_COLOR, fontSize: 13 }}
                // Short "$12k" labels: a narrower gutter leaves the bars more room.
                width={isPhone ? 48 : 64}
              />
              <Tooltip
                content={FinanceTooltip}
                cursor={{ fill: GRID_COLOR }}
                isAnimationActive={false}
              />
              <Bar
                dataKey="income"
                name="Ingresos"
                stackId="revenue"
                fill={INCOME_COLOR}
                maxBarSize={isPhone ? 16 : 24}
                shape={IncomeShape}
              />
              <Bar
                dataKey="courtesy"
                name="Cortesías (no cobrado)"
                stackId="revenue"
                fill={COURTESY_COLOR}
                maxBarSize={isPhone ? 16 : 24}
                shape={TopShape}
              />
              <Bar
                dataKey="expenses"
                name="Gastos"
                fill={EXPENSES_COLOR}
                maxBarSize={isPhone ? 16 : 24}
                shape={TopShape}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
};
