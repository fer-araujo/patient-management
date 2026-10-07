import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Edit2, Loader2, Plus, Scale, Trash2 } from "lucide-react";
import { Button } from "../../../../components/ui/Button";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import {
  createBodyMeasurement,
  deleteBodyMeasurement,
  listBodyMeasurements,
  updateBodyMeasurement,
  type BodyMeasurement,
  type BodyMeasurementInput,
} from "../../../../lib/services/bodyMeasurementService";
import { nowInClinic } from "../../../../lib/clinicTime";
import {
  formatIndicator,
  formatMeasurementDate,
  type BodySex,
  type IndicatorKey,
} from "../../utils/bodyComposition";
import {
  emptyMeasurementForm,
  toMeasurementForm,
  type MeasurementForm,
} from "../../utils/measurementForm";
import { ConfirmDialog } from "./ConfirmDialog";
import { LatestMeasurementCard } from "./LatestMeasurementCard";
import { MeasurementFormModal } from "./MeasurementFormModal";
import { WeightTrendChart } from "./WeightTrendChart";

/** Oldest first; same-day measurements in the order they were recorded. */
const byDate = (a: BodyMeasurement, b: BodyMeasurement) =>
  a.measured_at === b.measured_at
    ? a.created_at.localeCompare(b.created_at)
    : a.measured_at.localeCompare(b.measured_at);

const ACTION_BUTTON_CLASSES =
  "min-h-11 text-sm font-bold px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm";

const valueCell = (key: IndicatorKey) => (m: BodyMeasurement) => {
  const value = m[key];
  return (
    <span className="text-base font-bold text-brand-dark">
      {value === null ? "—" : formatIndicator(value, key)}
    </span>
  );
};

interface FormState {
  key: number;
  editing: BodyMeasurement | null;
  initial: MeasurementForm;
}

interface Props {
  patientId: string;
  patientName: string;
  sex: BodySex;
  /**
   * The consultation this tab is open in, with its clinic date
   * ("YYYY-MM-DD"): a measurement dated that day is linked to it.
   */
  appointment?: { id: string; date: string };
  /** Typed in the consultation's vital signs, to pre-fill a new measurement. */
  prefill?: { weight?: string; height?: string };
  /** Anonymized record: nothing can be added, changed or removed. */
  readOnly: boolean;
  /** "Dejar de llevar control" (after confirmation). Rejects on failure. */
  onStopTracking: () => Promise<void>;
}

/** "Control de peso": latest measurement, trend and history (InBody). */
export const WeightTrackingTab = ({
  patientId,
  patientName,
  sex,
  appointment,
  prefill,
  readOnly,
  onStopTracking,
}: Props) => {
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [formState, setFormState] = useState<FormState | null>(null);
  // Unique per opened form (Date.now() can repeat within one millisecond).
  const formKeyRef = useRef(0);
  const nextFormKey = () => {
    formKeyRef.current += 1;
    return formKeyRef.current;
  };
  const [toDelete, setToDelete] = useState<BodyMeasurement | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStopOpen, setIsStopOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // The parent mounts one tab per patient (key), so this loads once.
  useEffect(() => {
    let active = true;
    listBodyMeasurements(patientId)
      .then((rows) => {
        if (active) setMeasurements([...rows].sort(byDate));
      })
      .catch((err: unknown) => {
        console.error(
          "Error cargando mediciones:",
          err instanceof Error ? err.message : err,
        );
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patientId]);

  const today = nowInClinic().isoDate;
  const latest = measurements.at(-1) ?? null;

  const openNew = () =>
    setFormState({
      key: nextFormKey(),
      editing: null,
      initial: emptyMeasurementForm(today, {
        weight: prefill?.weight,
        // Height barely changes: the last one recorded is a good default.
        height:
          prefill?.height?.trim() ||
          (latest?.height_cm != null ? String(latest.height_cm) : ""),
      }),
    });

  const openEdit = (m: BodyMeasurement) =>
    setFormState({ key: nextFormKey(), editing: m, initial: toMeasurementForm(m) });

  /**
   * Linked to this consultation only when dated on the consultation's own
   * clinic day (not "today": a consultation reviewed later keeps its day); a
   * past result transcribed during a consultation is not part of it. An edit
   * keeps its link while the date does not change, and is re-evaluated
   * against this consultation when the date moves.
   */
  const appointmentFor = (
    measuredAt: string,
    editing: BodyMeasurement | null,
  ): string | null => {
    if (editing && editing.measured_at === measuredAt) return editing.appointment_id;
    return appointment && measuredAt === appointment.date ? appointment.id : null;
  };

  const handleSave = async (value: Omit<BodyMeasurementInput, "appointment_id">) => {
    if (!formState) return;
    const { editing, key } = formState;
    const input: BodyMeasurementInput = {
      ...value,
      appointment_id: appointmentFor(value.measured_at, editing),
    };
    const saved = editing
      ? await updateBodyMeasurement(editing.id, input)
      : await createBodyMeasurement(patientId, input);
    setMeasurements((prev) =>
      [...prev.filter((m) => m.id !== saved.id), saved].sort(byDate),
    );
    // Close only the form that sent this save, never a newer one.
    setFormState((current) => (current?.key === key ? null : current));
    toast.success(editing ? "Medición corregida." : "Medición guardada.");
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    try {
      await deleteBodyMeasurement(toDelete.id);
      setMeasurements((prev) => prev.filter((m) => m.id !== toDelete.id));
      setToDelete(null);
      toast.success("Medición borrada.");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error && err.message ? err.message : "No se pudo borrar la medición.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await onStopTracking();
      setIsStopOpen(false);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo dejar el control de peso.",
      );
    } finally {
      setIsStopping(false);
    }
  };

  const columns: ColumnDef<BodyMeasurement>[] = [
    {
      header: "Fecha",
      mobileRole: "title",
      accessorKey: "measured_at",
      sortable: true,
      cell: (m) => (
        <span className="text-base font-bold text-brand-dark whitespace-nowrap">
          {formatMeasurementDate(m.measured_at)}
        </span>
      ),
    },
    { header: "Peso (kg)", cell: valueCell("weight_kg") },
    { header: "IMC", cell: valueCell("bmi") },
    { header: "% grasa", cell: valueCell("body_fat_pct") },
    { header: "Músculo (kg)", cell: valueCell("skeletal_muscle_kg") },
    { header: "Grasa visceral", cell: valueCell("visceral_fat_level") },
    { header: "Cintura-cadera", cell: valueCell("waist_hip_ratio") },
    ...(readOnly
      ? []
      : [
          {
            header: "Acciones",
            mobileRole: "actions" as const,
            cell: (m: BodyMeasurement) => {
              const date = formatMeasurementDate(m.measured_at);
              return (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(m)}
                    aria-label={`Editar la medición del ${date}`}
                    className={ACTION_BUTTON_CLASSES}
                  >
                    <Edit2 className="w-4 h-4" /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setToDelete(m)}
                    aria-label={`Borrar la medición del ${date}`}
                    className={ACTION_BUTTON_CLASSES}
                  >
                    <Trash2 className="w-4 h-4" /> Borrar
                  </button>
                </div>
              );
            },
          },
        ]),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-lg font-bold text-brand-dark">Control de peso</h3>
          <p className="text-sm text-brand-gray mt-0.5">
            Mediciones de la báscula InBody.
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setIsStopOpen(true)}
              className={`${ACTION_BUTTON_CLASSES} justify-center`}
            >
              Dejar de llevar control
            </button>
            <Button
              type="button"
              onClick={openNew}
              disabled={isLoading || loadFailed}
              className="w-full sm:w-auto px-5 py-3 text-sm rounded-lg cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2 disabled:opacity-50"
            >
              <Plus className="w-5 h-5" /> Nueva medición
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-8 h-8 animate-spin text-brand-primary opacity-50" />
        </div>
      ) : loadFailed ? (
        <p className="text-base text-brand-gray text-center py-10">
          No se pudieron cargar las mediciones. Cierra y vuelve a abrir el expediente.
        </p>
      ) : measurements.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <Scale className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-base font-medium text-brand-gray">
            Aún no hay mediciones. Registra la primera con «Nueva medición».
          </p>
        </div>
      ) : (
        <>
          {latest && (
            <LatestMeasurementCard latest={latest} history={measurements} sex={sex} />
          )}
          <WeightTrendChart measurements={measurements} />
          <section aria-labelledby="measurement-history-title" className="space-y-3">
            <h4
              id="measurement-history-title"
              className="text-xs font-black text-brand-gray uppercase tracking-widest"
            >
              Historial
            </h4>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <DataGrid
                data={[...measurements].reverse()}
                columns={columns}
                keyExtractor={(m) => m.id}
              />
            </div>
          </section>
        </>
      )}

      {formState && (
        <MeasurementFormModal
          key={formState.key}
          isOpen={true}
          onClose={() => setFormState(null)}
          title={formState.editing ? "Editar medición" : "Nueva medición"}
          initial={formState.initial}
          today={today}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        isOpen={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        isBusy={isDeleting}
        tone="danger"
        title="Borrar medición"
        icon={<Trash2 className="w-8 h-8" strokeWidth={2.5} />}
        question={
          toDelete
            ? `¿Borrar la medición del ${formatMeasurementDate(toDelete.measured_at)}?`
            : ""
        }
        description="Úsalo solo si se capturó por error. El borrado queda en la Bitácora."
        confirmLabel="Sí, borrar"
      />

      <ConfirmDialog
        isOpen={isStopOpen}
        onClose={() => setIsStopOpen(false)}
        onConfirm={handleStop}
        isBusy={isStopping}
        title="Control de peso"
        icon={<Scale className="w-8 h-8" strokeWidth={2.5} />}
        question={`¿Dejar de llevar el control de peso de ${patientName}?`}
        description="La pestaña se ocultará. Las mediciones guardadas no se borran y vuelven a aparecer si lo activas otra vez."
        confirmLabel="Sí, dejar de llevarlo"
      />
    </div>
  );
};
