import { useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Lock, Save } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import {
  CLOSE_NOTE_REQUIRES_MESSAGE,
  closeClinicalNote,
  saveSoapNote,
  type SoapNote,
} from "../../../lib/services/soapService";
import {
  parseVitalSigns,
  toVitalSignsForm,
  type VitalSignsForm,
} from "../utils/vitalSigns";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { ConfirmDialog } from "./weight/ConfirmDialog";
import { VitalSignsFields } from "./VitalSignsFields";
import { NOTE_FIELDS, toNoteForm, type NoteForm } from "../utils/noteFields";

interface OpenNoteEditorProps {
  /** An open note (isNoteAwaitingClose). */
  note: SoapNote;
  /** Prefix for the field ids, unique on the page. */
  idPrefix?: string;
  /** After "Guardar": the note with what was saved. */
  onSaved?: (note: SoapNote) => void;
  /** After "Cerrar nota": the note as it was frozen. */
  onClosed: (note: SoapNote) => void;
}

const TEXTAREA_CLASSES =
  "mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed";

const CLOSE_NOTE_DESCRIPTION =
  "Al cerrar la nota ya no se podrá modificar; las correcciones se harán con una adenda.";

/**
 * The open note of a finalized consultation or of a past visit, editable
 * outside the consultation (record and calendar). "Guardar" saves a draft
 * (same path as the consultation); "Cerrar nota" asks first, saves, then
 * freezes it on the server (close_clinical_note).
 */
export const OpenNoteEditor = ({
  note,
  idPrefix = "open-note",
  onSaved,
  onClosed,
}: OpenNoteEditorProps) => {
  const [soap, setSoap] = useState<NoteForm>(() => toNoteForm(note));
  const [vitals, setVitals] = useState<VitalSignsForm>(() =>
    toVitalSignsForm(note.vitalSigns),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const setField = (key: keyof NoteForm, value: string) =>
    setSoap((prev) => ({ ...prev, [key]: value }));

  /** Saves what is on screen; returns the saved note, or null on error. */
  const persist = async (): Promise<SoapNote | null> => {
    const parsed = parseVitalSigns(vitals);
    if (!parsed.ok) {
      toast.error(parsed.message);
      return null;
    }
    await saveSoapNote(note.appointmentId, note.patientId, {
      ...soap,
      vitalSigns: parsed.value,
    });
    return { ...note, ...soap, vitalSigns: parsed.value };
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const saved = await persist();
      if (!saved) return;
      toast.success("Nota guardada.");
      onSaved?.(saved);
    } catch (err: unknown) {
      console.error("[OpenNoteEditor] save failed:", err instanceof Error ? err.message : err);
      toast.error(
        err instanceof Error && err.message ? err.message : "No se pudo guardar la nota.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseClick = () => {
    if (!soap.analysis.trim() || !soap.plan.trim()) {
      toast.error(CLOSE_NOTE_REQUIRES_MESSAGE);
      return;
    }
    const parsed = parseVitalSigns(vitals);
    if (!parsed.ok) {
      toast.error(parsed.message);
      return;
    }
    setIsConfirmOpen(true);
  };

  const handleConfirmClose = async () => {
    setIsSaving(true);
    try {
      const saved = await persist();
      if (!saved) return;
      const closed = await closeClinicalNote(note.id);
      setIsConfirmOpen(false);
      toast.success("Nota cerrada.");
      onClosed({ ...saved, ...closed });
    } catch (err: unknown) {
      console.error("[OpenNoteEditor] close failed:", err instanceof Error ? err.message : err);
      toast.error(
        err instanceof Error && err.message ? err.message : "No se pudo cerrar la nota.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const fieldId = (key: string) => `${idPrefix}-${key}`;

  return (
    <div className="flex flex-col grow gap-5">
      <div>
        <p className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
          Signos vitales
        </p>
        <div className="mt-2">
          <VitalSignsFields value={vitals} onChange={setVitals} disabled={isSaving} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {NOTE_FIELDS.map(({ key, label, placeholder }) => (
          <div
            key={key}
            className={`flex flex-col h-full ${key === "plan" ? "md:col-span-2" : ""}`}
          >
            <label
              htmlFor={fieldId(key)}
              className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
            >
              {label}
            </label>
            <AutoGrowTextarea
              id={fieldId(key)}
              disabled={isSaving}
              value={soap[key]}
              onChange={(e) => setField(key, e.target.value)}
              placeholder={placeholder}
              className={TEXTAREA_CLASSES}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 justify-end max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="px-6 py-2.5 min-h-11 flex items-center justify-center gap-2 cursor-pointer text-sm font-bold text-brand-primary border-brand-primary disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="w-4 h-4" aria-hidden="true" />
          )}
          Guardar
        </Button>
        <Button
          type="button"
          onClick={handleCloseClick}
          disabled={isSaving}
          className="px-6 py-2.5 min-h-11 flex items-center justify-center gap-2 cursor-pointer text-sm disabled:opacity-50"
        >
          <Lock className="w-4 h-4" aria-hidden="true" />
          Cerrar nota
        </Button>
      </div>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={() => void handleConfirmClose()}
        isBusy={isSaving}
        title="Cerrar nota"
        icon={<Lock className="w-8 h-8" strokeWidth={2.5} />}
        question="¿Cerrar la nota clínica?"
        description={CLOSE_NOTE_DESCRIPTION}
        confirmLabel="Cerrar nota"
      />
    </div>
  );
};
