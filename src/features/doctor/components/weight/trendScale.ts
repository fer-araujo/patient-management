/** Rounds to `decimals` places, dropping binary noise (69.49999 -> 69.5). */
const roundTo = (value: number, decimals: number) => Number(value.toFixed(decimals));

/**
 * Y domain of a trend: some air above and below the values, with both ends on
 * the indicator's precision (whole numbers for an integer indicator such as
 * the visceral fat level). Never below zero. An all-equal series still gets a
 * band around its value.
 */
export const yDomain = (values: number[], decimals: number): [number, number] => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.2, decimals === 0 ? 1 : 10 ** -decimals * 5);
  const factor = 10 ** decimals;
  // The epsilon keeps 69.5 (stored as 69.49999...) from flooring to 69.4.
  const lo = Math.floor(roundTo((min - pad) * factor, 6)) / factor;
  const hi = Math.ceil(roundTo((max + pad) * factor, 6)) / factor;
  return [Math.max(0, roundTo(lo, decimals)), roundTo(hi, decimals)];
};

/**
 * Y axis settings for a trend. Integer indicators get whole-number ticks only
 * (no "7.5" that would print as a duplicate "8") and at most one tick per
 * whole number.
 */
export const yAxisScale = (values: number[], decimals: number) => {
  const domain = yDomain(values, decimals);
  const integer = decimals === 0;
  return {
    domain,
    allowDecimals: !integer,
    tickCount: integer ? Math.min(5, domain[1] - domain[0] + 1) : 5,
  };
};
