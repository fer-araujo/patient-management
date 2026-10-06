import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { BodyMeasurement } from "../../../../lib/services/bodyMeasurementService";
import {
  INDICATORS,
  formatIndicator,
  formatMeasurementDate,
  formatWithUnit,
  measurementDateToMs,
  type IndicatorKey,
} from "../../utils/bodyComposition";
import {
  AXIS_COLOR,
  GRID_COLOR,
  INK_COLOR,
  SURFACE_COLOR,
  TEXT_COLOR,
  TREND_COLOR,
} from "./weightColors";
import { yAxisScale } from "./trendScale";

/** The indicators the doctor can chart, one at a time (never a dual axis). */
const TREND_OPTIONS: { key: IndicatorKey; label: string }[] = [
  { key: "weight_kg", label: "Peso" },
  { key: "body_fat_pct", label: "% grasa" },
  { key: "skeletal_muscle_kg", label: "Masa muscular" },
  { key: "visceral_fat_level", label: "Grasa visceral" },
  { key: "bmi", label: "IMC" },
];

interface Point {
  x: number;
  value: number;
  date: string;
}

const seriesTitle = (key: IndicatorKey) => {
  const { label, unit } = INDICATORS[key];
  return unit ? `${label} (${unit})` : label;
};

/** Value first (strong), date second; a short line key in the series color. */
const makeTooltip =
  (key: IndicatorKey) =>
  ({ active, payload }: TooltipContentProps) => {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0].payload as Point;
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl px-4 py-3 space-y-1">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-3 h-0.5 rounded-full"
            style={{ backgroundColor: TREND_COLOR }}
          />
          <span className="text-base font-black text-brand-dark">
            {formatWithUnit(point.value, key)}
          </span>
        </div>
        <p className="text-sm font-medium text-brand-gray">
          {formatMeasurementDate(point.date, false)}
        </p>
      </div>
    );
  };

interface EndLabelProps {
  x?: number | string;
  y?: number | string;
  index?: number;
}

interface Props {
  measurements: BodyMeasurement[];
}

/** Trend of one indicator over time, with a segmented indicator selector. */
export const WeightTrendChart = ({ measurements }: Props) => {
  const [selected, setSelected] = useState<IndicatorKey>("weight_kg");
  const info = INDICATORS[selected];

  const points: Point[] = measurements
    .filter((m) => m[selected] !== null)
    .map((m) => ({
      x: measurementDateToMs(m.measured_at),
      value: m[selected] as number,
      date: m.measured_at,
    }));
  const ticks = [...new Set(points.map((p) => p.x))];
  const lastIndex = points.length - 1;
  const yScale =
    points.length > 0 ? yAxisScale(points.map((p) => p.value), info.decimals) : null;

  const renderEndLabel = ({ x, y, index }: EndLabelProps) => {
    if (index !== lastIndex || x === undefined || y === undefined) return null;
    return (
      <text
        x={Number(x) + 10}
        y={Number(y)}
        dy={4}
        fill={INK_COLOR}
        fontSize={14}
        fontWeight={700}
      >
        {formatIndicator(points[lastIndex].value, selected)}
      </text>
    );
  };

  return (
    <section
      aria-labelledby="weight-trend-title"
      className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4"
    >
      <h4
        id="weight-trend-title"
        className="text-xs font-black text-brand-gray uppercase tracking-widest"
      >
        Tendencia
      </h4>

      <div role="group" aria-label="Dato a graficar" className="flex flex-wrap gap-2">
        {TREND_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected === option.key}
            onClick={() => setSelected(option.key)}
            className={`min-h-11 px-4 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${selected === option.key ? "bg-brand-primary border-brand-primary text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-brand-dark"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <figure className="space-y-2">
        <figcaption className="text-base font-bold text-brand-dark">
          {seriesTitle(selected)}
        </figcaption>
        {points.length > 1 && (
          <p className="text-sm font-medium text-brand-gray">
            Último valor: {formatWithUnit(points[lastIndex].value, selected)} el{" "}
            {formatMeasurementDate(points[lastIndex].date)} · {points.length} mediciones
          </p>
        )}
        {points.length === 0 ? (
          <p className="text-base text-brand-gray font-medium py-10 text-center">
            Aún no hay mediciones con este dato.
          </p>
        ) : points.length === 1 ? (
          <p className="text-base text-brand-gray font-medium py-10 text-center">
            Solo hay una medición: {formatWithUnit(points[0].value, selected)} el{" "}
            {formatMeasurementDate(points[0].date)}. Con la siguiente verás la tendencia.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={points}
                margin={{ top: 16, right: 56, bottom: 0, left: 0 }}
                title={`Tendencia de ${seriesTitle(selected)}`}
              >
                <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                <XAxis
                  dataKey="x"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  ticks={ticks}
                  tickFormatter={(ms: number) =>
                    formatMeasurementDate(new Date(ms).toISOString().slice(0, 10))
                  }
                  tickLine={false}
                  axisLine={{ stroke: AXIS_COLOR }}
                  tick={{ fill: TEXT_COLOR, fontSize: 13, fontWeight: 700 }}
                  tickMargin={8}
                  padding={{ left: 24, right: 24 }}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  domain={yScale?.domain}
                  allowDecimals={yScale?.allowDecimals}
                  tickCount={yScale?.tickCount}
                  tickFormatter={(value: number) => formatIndicator(value, selected)}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: TEXT_COLOR, fontSize: 13 }}
                  width={56}
                />
                <Tooltip
                  content={makeTooltip(selected)}
                  cursor={{ stroke: AXIS_COLOR, strokeWidth: 1 }}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="value"
                  name={info.label}
                  stroke={TREND_COLOR}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  dot={{ r: 5, fill: TREND_COLOR, stroke: SURFACE_COLOR, strokeWidth: 2 }}
                  activeDot={{ r: 8, fill: TREND_COLOR, stroke: SURFACE_COLOR, strokeWidth: 2 }}
                  label={renderEndLabel}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </figure>
    </section>
  );
};
