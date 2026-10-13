import type { SoapNote } from "../../../lib/services/soapService";

/** "13 oct 2026, 06:45 p.m." in the clinic's locale. */
const formatClosedAt = (iso: string): string =>
  new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * NOM-004 5.10 (honest date and time): the line shown on the header of a
 * note recorded after the fact, e.g. "Registrada posteriormente · cerrada el
 * 13 oct 2026, 06:45 p.m.". Null when the note was written on time.
 */
export const describeLateEntry = (
  note: Pick<SoapNote, "recordedLate" | "finalizedAt">,
): string | null => {
  if (!note.recordedLate) return null;
  return note.finalizedAt
    ? `Registrada posteriormente · cerrada el ${formatClosedAt(note.finalizedAt)}`
    : "Registrada posteriormente";
};
