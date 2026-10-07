import type { BodyMeasurement } from "../../../../lib/services/bodyMeasurementService";
import {
  INDICATORS,
  LEVEL_LABELS,
  balanceLabel,
  bodyTypeLabel,
  cidLabel,
  classifyLevel,
  describeChange,
  formatIndicator,
  formatMeasurementDate,
  formatWithUnit,
  markerPosition,
  referenceScale,
  zoneWidths,
  type BodySex,
  type IndicatorKey,
  type LevelScale,
  type LevelZone,
} from "../../utils/bodyComposition";
import { ZONE_COLORS } from "./weightColors";

/** Indicators of the card, in the order of the InBody sheet. */
const CARD_INDICATORS: IndicatorKey[] = [
  "weight_kg",
  "bmi",
  "body_fat_pct",
  "skeletal_muscle_kg",
  "visceral_fat_level",
  "waist_hip_ratio",
  "body_fat_kg",
  "lean_mass_kg",
  "bmr_kcal",
];

const SEX_SPECIFIC: IndicatorKey[] = ["body_fat_pct", "waist_hip_ratio"];

const ZONES: LevelZone[] = ["low", "normal", "high"];

const rangeText = (scale: LevelScale, key: IndicatorKey): string =>
  scale.normalMin === null
    ? `normal hasta ${formatIndicator(scale.normalMax, key)}`
    : `normal de ${formatIndicator(scale.normalMin, key)} a ${formatIndicator(scale.normalMax, key)}`;

/**
 * Horizontal level bar: Bajo / Normal / Alto zones separated by a surface
 * gap, a dark marker at the value, and a text label under each zone.
 */
const LevelBar = ({
  value,
  scale,
  indicator,
}: {
  value: number;
  scale: LevelScale;
  indicator: IndicatorKey;
}) => {
  const widths = zoneWidths(scale);
  const zones = ZONES.filter((zone) => widths[zone] > 0);
  const position = markerPosition(value, scale) * 100;
  const level = classifyLevel(value, scale);
  return (
    <div className="mt-3">
      <div
        role="img"
        aria-label={`${INDICATORS[indicator].label} ${formatWithUnit(value, indicator)}: ${LEVEL_LABELS[level]} (${rangeText(scale, indicator)})`}
        className="relative pt-2"
      >
        {/* Marker: a dark tick with a surface ring, above the zones. */}
        <span
          aria-hidden="true"
          className="absolute top-0 -bottom-1 w-1.5 -ml-0.75 rounded-full bg-brand-dark ring-2 ring-white z-10"
          style={{ left: `${position}%` }}
        />
        <div className="flex gap-0.5 h-2.5">
          {zones.map((zone, i) => (
            <span
              key={zone}
              className={`h-full ${i === 0 ? "rounded-l-full" : ""} ${i === zones.length - 1 ? "rounded-r-full" : ""}`}
              style={{ width: `${widths[zone] * 100}%`, backgroundColor: ZONE_COLORS[zone] }}
            />
          ))}
        </div>
      </div>
      {/* Zone names stay readable: full words, wrapping if a zone is narrow. */}
      <div className="flex gap-0.5 mt-1.5">
        {zones.map((zone) => (
          <span
            key={zone}
            className="min-w-0 text-sm leading-tight font-bold text-brand-gray text-center break-words"
            style={{ width: `${widths[zone] * 100}%` }}
          >
            {LEVEL_LABELS[zone]}
          </span>
        ))}
      </div>
    </div>
  );
};

interface Props {
  latest: BodyMeasurement;
  /** Every measurement, oldest first (the latest included). */
  history: BodyMeasurement[];
  sex: BodySex;
}

/** The most recent earlier measurement that has a value for `key`. */
const previousValue = (
  history: BodyMeasurement[],
  latest: BodyMeasurement,
  key: IndicatorKey,
): { value: number; date: string } | null => {
  const index = history.findIndex((m) => m.id === latest.id);
  for (let i = index - 1; i >= 0; i -= 1) {
    const value = history[i][key];
    if (value !== null) return { value, date: history[i].measured_at };
  }
  return null;
};

/** "Última medición": InBody-style values, levels and change. */
export const LatestMeasurementCard = ({ latest, history, sex }: Props) => {
  const indicators = CARD_INDICATORS.filter((key) => latest[key] !== null);
  const missingSexRange =
    sex === null && SEX_SPECIFIC.some((key) => latest[key] !== null);
  const classifications = [
    { label: "Equilibrio superior-inferior", value: balanceLabel(latest.balance_upper_lower) },
    { label: "Tipo de cuerpo", value: bodyTypeLabel(latest.body_type) },
    { label: "Forma C / I / D", value: cidLabel(latest.cid_type) },
  ].filter((item): item is { label: string; value: string } => item.value !== null);

  return (
    <section
      aria-labelledby="latest-measurement-title"
      className="bg-white rounded-2xl p-5 max-md:p-4 border border-slate-200 shadow-sm"
    >
      <h4
        id="latest-measurement-title"
        className="text-xs font-black text-brand-gray uppercase tracking-widest"
      >
        Última medición
      </h4>
      <p className="text-base font-bold text-brand-dark mt-1">
        {formatMeasurementDate(latest.measured_at, false)}
      </p>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
        {indicators.map((key) => {
          const value = latest[key] as number;
          const info = INDICATORS[key];
          const scale = referenceScale(key, sex);
          const previous = previousValue(history, latest, key);
          const change = previous ? describeChange(value, previous.value, key) : null;
          return (
            <li
              key={key}
              aria-label={info.label}
              className="bg-slate-50 p-3 rounded-xl border border-slate-100"
            >
              <p className="text-sm font-bold text-brand-gray uppercase">{info.label}</p>
              <p className="mt-0.5 text-brand-dark">
                <span className="text-2xl font-extrabold">{formatIndicator(value, key)}</span>
                {info.unit && (
                  <span className="text-sm font-bold text-brand-gray ml-1">{info.unit}</span>
                )}
                {scale && (
                  <span className="text-sm font-bold text-brand-dark ml-2 inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: ZONE_COLORS[classifyLevel(value, scale)] }}
                    />
                    {LEVEL_LABELS[classifyLevel(value, scale)]}
                  </span>
                )}
              </p>
              <p className="text-sm font-medium text-brand-gray mt-0.5">
                {change && previous
                  ? `${change.text} desde el ${formatMeasurementDate(previous.date)}`
                  : "Sin medición anterior"}
              </p>
              {scale && <LevelBar value={value} scale={scale} indicator={key} />}
            </li>
          );
        })}
      </ul>

      {classifications.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {classifications.map((item) => (
            <div key={item.label}>
              <dt className="text-sm font-bold text-brand-gray uppercase">{item.label}</dt>
              <dd className="text-base font-bold text-brand-dark mt-0.5">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {missingSexRange && (
        <p className="text-sm font-medium text-brand-gray mt-4">
          Registra el sexo del paciente para ver los rangos de grasa corporal y
          cintura-cadera.
        </p>
      )}
      {latest.note && (
        <p className="text-base text-slate-600 mt-4 whitespace-pre-wrap">{latest.note}</p>
      )}
    </section>
  );
};
