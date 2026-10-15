import { useEffect, useState } from "react";
import { Lock, PenLine } from "lucide-react";
import {
  fetchAppointmentNote,
  isNoteAwaitingClose,
  type SoapNote,
} from "../../../lib/services/soapService";
import { describeLateEntry } from "../utils/noteStatus";
import { NotePendingBadge } from "./NotePendingBadge";
import { OpenNoteEditor } from "./OpenNoteEditor";

interface AppointmentNotePanelProps {
  appointmentId: string;
  /** Runs after the note is saved or closed, so the agenda can refetch. */
  onNoteChanged?: () => void;
}

/** "13 oct 2026, 06:45 p.m." */
const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * "Nota clínica" in the calendar's detail of a completed appointment. An open
 * note (consultation finalized or past visit) shows "Nota pendiente de
 * cerrar" and "Completar nota", which opens the editor right here; a closed
 * one only says when it was closed. Renders nothing while loading, when the
 * appointment has no note, or when the note cannot be read.
 */
export const AppointmentNotePanel = ({
  appointmentId,
  onNoteChanged,
}: AppointmentNotePanelProps) => {
  const [note, setNote] = useState<SoapNote | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAppointmentNote(appointmentId)
      .then((loaded) => {
        if (active) setNote(loaded);
      })
      .catch((err: unknown) => {
        console.error(
          "[AppointmentNotePanel] Error al cargar la nota:",
          err instanceof Error ? err.message : err,
        );
      });
    return () => {
      active = false;
    };
  }, [appointmentId]);

  if (!note) return null;

  const isOpen = isNoteAwaitingClose(note);
  if (!isOpen && !note.finalizedAt) return null;
  const lateEntry = describeLateEntry(note);

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest">
          Nota clínica
        </h4>
        {isOpen && <NotePendingBadge />}
      </div>

      {isOpen ? (
        isEditing ? (
          <OpenNoteEditor
            note={note}
            idPrefix={`calendar-note-${note.id}`}
            onSaved={(saved) => {
              setNote(saved);
              onNoteChanged?.();
            }}
            onClosed={(closed) => {
              setNote(closed);
              setIsEditing(false);
              onNoteChanged?.();
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-500">
              {lateEntry ?? "La consulta se finalizó; falta cerrar la nota."}
            </p>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-sm font-bold text-brand-primary hover:underline cursor-pointer shrink-0 pointer-coarse:min-h-11 pointer-coarse:px-3 flex items-center gap-1.5"
            >
              <PenLine className="w-4 h-4" aria-hidden="true" /> Completar nota
            </button>
          </div>
        )
      ) : (
        <p className="text-sm font-medium text-slate-500 flex items-center gap-1.5">
          <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
          {lateEntry ?? `Nota cerrada el ${formatDateTime(note.finalizedAt ?? "")}`}
        </p>
      )}
    </div>
  );
};
