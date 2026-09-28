import { useState } from "react";
import toast from "react-hot-toast";
import { Lock, Loader2, PenLine } from "lucide-react";
import {
  addNoteAddendum,
  type NoteAddendum,
  type SoapNote,
} from "../../../lib/services/soapService";

interface NoteAddendaProps {
  note: SoapNote;
  onAdded: (addendum: NoteAddendum) => void;
}

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Addenda shown under a note in the patient's history, oldest first.
 *
 * A finalized note can never be edited (NOM-004-SSA3-2012); corrections are
 * appended here and are themselves permanent. Notes of consultations that
 * were never finalized show no form: the database only accepts addenda on
 * finalized notes.
 */
export const NoteAddenda = ({ note, onAdded }: NoteAddendaProps) => {
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!draft.trim()) return;
    setIsSaving(true);
    try {
      const addendum = await addNoteAddendum(note.id, draft);
      onAdded(addendum);
      setDraft("");
      toast.success("Corrección agregada al expediente.");
    } catch (err) {
      console.error("[NoteAddenda] save failed:", err);
      toast.error(
        err instanceof Error ? err.message : "No se pudo guardar la corrección.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold text-brand-dark">Correcciones</h4>
        {note.finalizedAt ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
            <Lock className="w-3 h-3" aria-hidden="true" />
            Nota cerrada el {formatDateTime(note.finalizedAt)}
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-bold text-amber-700">
            Consulta no finalizada
          </span>
        )}
      </div>

      {note.addenda.length > 0 ? (
        <ol className="space-y-2">
          {note.addenda.map((addendum) => (
            <li
              key={addendum.id}
              className="rounded-lg border-l-4 border-brand-primary bg-slate-50 px-3 py-2"
            >
              <p className="text-xs font-semibold text-brand-gray">
                {formatDateTime(addendum.createdAt)}
                {addendum.authorName ? ` · ${addendum.authorName}` : ""}
              </p>
              <p className="text-sm text-brand-dark whitespace-pre-wrap mt-0.5">
                {addendum.body}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-brand-gray">Sin correcciones.</p>
      )}

      {note.finalizedAt && (
        <div className="space-y-2 pt-3 border-t border-slate-100">
          <label
            htmlFor={`addendum-${note.id}`}
            className="block text-sm font-semibold text-brand-dark"
          >
            Agregar una corrección
          </label>
          <p className="text-xs text-brand-gray">
            La nota original no cambia. La corrección queda con fecha y hora y
            no se puede borrar.
          </p>
          <textarea
            id={`addendum-${note.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 5000))}
            placeholder="Ej. La dosis indicada es 200 mg, no 400 mg."
            rows={3}
            className="w-full px-3 py-2.5 border-2 border-brand-light rounded-xl text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all resize-none"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !draft.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-primary hover:bg-brand-primary-hover px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <PenLine className="w-4 h-4" aria-hidden="true" />
            )}
            {isSaving ? "Guardando..." : "Guardar corrección"}
          </button>
        </div>
      )}
    </section>
  );
};
