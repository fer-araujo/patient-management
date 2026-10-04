/**
 * Marks a consultation finalized without its supplies ("Registrar insumos").
 * Same shape as PendingBadge, in the app's rose warning palette.
 */
export const SuppliesPendingBadge = () => (
  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border text-rose-600 bg-rose-50 border-rose-200 shrink-0 leading-none">
    Sin insumos
  </span>
);
