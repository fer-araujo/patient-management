/**
 * Marks a finalized consultation (or a past visit) whose clinical note is
 * still open ("Cerrar nota" pending). Same shape and amber palette as the
 * calendar's PendingBadge. `compact` (calendar chips, little room) shows
 * "Nota pendiente" and keeps the full text for screen readers.
 */
export const NotePendingBadge = ({ compact = false }: { compact?: boolean }) => (
  <span
    title="Nota pendiente de cerrar"
    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border text-amber-600 bg-amber-50 border-amber-200 shrink-0 leading-none"
  >
    {compact ? (
      <>
        <span aria-hidden="true">Nota pendiente</span>
        <span className="sr-only">Nota pendiente de cerrar</span>
      </>
    ) : (
      "Nota pendiente de cerrar"
    )}
  </span>
);
