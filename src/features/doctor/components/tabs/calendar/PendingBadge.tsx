/**
 * Marks an appointment that still waits for confirmation (e.g. just
 * rescheduled). Same amber palette as the "Pendiente" status in the inbox.
 * `overdue` (its start time already passed) reads "Vencida" instead.
 */
export const PendingBadge = ({ overdue = false }: { overdue?: boolean }) => (
  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border text-amber-600 bg-amber-50 border-amber-200 shrink-0 leading-none">
    {overdue ? "Vencida" : "Pendiente"}
  </span>
);
