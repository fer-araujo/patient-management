// Colors of the weight-tracking marks. SVG fills and inline bar segments
// cannot read the Tailwind tokens, so the hex values live here.
//
// Level bar zones (validated with the dataviz palette validator, light
// surface, all pairs): normal = --color-brand-primary, high = rose-500,
// low = slate-300 (a neutral on purpose: "below the range" is not a series
// hue). Teal/rose CVD separation is ΔE 9.0 (deutan), above the 8 target;
// rose-400 (the finance "Gastos" color) was only 5.8 next to the teal, so
// the darker rose-500 is used here. Every zone is under 3:1 contrast on
// white, so each one carries a visible text label ("Bajo / Normal / Alto")
// and the measured level is also written as text.
export const ZONE_COLORS = {
  low: "#cbd5e1", // slate-300
  normal: "#07a996", // brand teal
  high: "#f43f5e", // rose-500
} as const;

// The trend chart has one series: the brand teal (same as the finance
// income series). Under 3:1 on white, so the end label, the tooltip and
// the "Historial" table carry every value as text.
export const TREND_COLOR = "#07a996";
export const TEXT_COLOR = "#5b5b5b"; // --color-brand-gray
export const INK_COLOR = "#040707"; // --color-brand-dark
export const GRID_COLOR = "#f1f5f9"; // slate-100
export const AXIS_COLOR = "#e2e8f0"; // slate-200
export const SURFACE_COLOR = "#ffffff"; // card surface (bg-white)
