import { useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Save,
} from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../../components/ui/Modal";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DatePicker } from "../../../../components/ui/DatePicker";
import { Input } from "../../../../components/ui/Input";
import { Button } from "../../../../components/ui/Button";
import {
  recordPastVisit,
  type DashboardAppointment,
} from "../../../../lib/services/clinicService";
import type { DashboardBlockedSlot } from "../../../../lib/services/blockedSlotsService";
import type { WeeklySchedule } from "../../../../lib/services/settingsService";
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type PaymentStatus,
} from "../../../../lib/services/financeService";
import { formatMXN } from "../../../../lib/services/inventoryService";
import { nowInClinic } from "../../../../lib/clinicTime";
import { getPastVisitTimeOptions } from "../../utils/calendarUtils";
import {
  BOOKING_CATALOG_ERROR,
  useBookingCatalog,
} from "../../hooks/useBookingCatalog";
import { NewPatientModal } from "./NewPatientModal";
import { AutoGrowTextarea } from "../AutoGrowTextarea";
import { VitalSignsFields } from "../VitalSignsFields";
import { EMPTY_NOTE_FORM, NOTE_FIELDS, type NoteForm } from "../../utils/noteFields";
import {
  EMPTY_VITAL_SIGNS,
  parseVitalSigns,
  type VitalSignsForm,
} from "../../utils/vitalSigns";

const METHODS: PaymentMethod[] = ["cash", "card", "transfer"];

/** Length used to list the times before a service is chosen. */
const DEFAULT_SLOT_MINS = 30;

/** "lunes, 12 de octubre de 2026", built as a local date. */
const formatVisitDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Calendar data, so the times offered skip what is already recorded. */
  appointments: DashboardAppointment[];
  blockedSlots: DashboardBlockedSlot[];
  workingSchedule: WeeklySchedule;
  /** Reloads the calendar after each saved visit. */
  onSaved: () => Promise<void>;
}

/**
 * "Registrar cita pasada": the doctor transcribes a visit that already
 * happened (her paper agenda) and what she charged for it. "Guardar y
 * registrar otra" keeps the modal open on the same day, so a whole agenda
 * page can be typed in a row. The server dates the charge to the visit.
 */
export const PastVisitModal = ({
  isOpen,
  onClose,
  appointments,
  blockedSlots,
  workingSchedule,
  onSaved,
}: Props) => {
  const catalog = useBookingCatalog();
  const { load: loadCatalog } = catalog;

  const [patientId, setPatientId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [isoDate, setIsoDate] = useState(() => nowInClinic().isoDate);
  const [time, setTime] = useState("");
  const [status, setStatus] = useState<PaymentStatus>("paid");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [note, setNote] = useState("");
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isNewPatientOpen, setIsNewPatientOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  // Optional "Nota clínica": saved open, to complete and close later.
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteForm, setNoteForm] = useState<NoteForm>(EMPTY_NOTE_FORM);
  const [noteVitals, setNoteVitals] = useState<VitalSignsForm>(EMPTY_VITAL_SIGNS);

  useEffect(() => {
    if (isOpen) loadCatalog();
  }, [isOpen, loadCatalog]);

  const service = catalog.services.find((s) => s.id === serviceId);
  const durationMins = service?.durationMins ?? DEFAULT_SLOT_MINS;

  const timeOptions = useMemo(
    () =>
      getPastVisitTimeOptions(
        isoDate,
        appointments,
        blockedSlots,
        workingSchedule,
        durationMins,
      ),
    [isoDate, appointments, blockedSlots, workingSchedule, durationMins],
  );

  const serviceOptions = useMemo(
    () =>
      catalog.services.length > 0
        ? catalog.services.map((s) => ({
            label:
              s.price !== null && s.price > 0
                ? `${s.name} · ${formatMXN(s.price)}`
                : s.name,
            value: s.id,
          }))
        : [
            {
              label: "No hay servicios activos en el catálogo",
              value: "",
              disabled: true,
            },
          ],
    [catalog.services],
  );

  const isClosedDay = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return !workingSchedule[new Date(y, m - 1, d).getDay()]?.isOpen;
  };

  const handleServiceChange = (id: string) => {
    setServiceId(id);
    const price = catalog.services.find((s) => s.id === id)?.price ?? null;
    setAmount(price !== null && price > 0 ? String(price) : "");
  };

  const isPaid = status === "paid";
  const parsedAmount = Number(amount);
  const isAmountValid =
    amount !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const isTimeValid = timeOptions.some((opt) => opt.value === time);
  const isValid =
    catalog.status === "ready" &&
    !!patientId &&
    !!serviceId &&
    isTimeValid &&
    (!isPaid || (isAmountValid && method !== null));

  /** Ready for the next row of the same agenda page: same day, empty rest. */
  const resetForNext = () => {
    setPatientId("");
    setServiceId("");
    setTime("");
    setStatus("paid");
    setAmount("");
    setMethod(null);
    setNote("");
    setNoteForm(EMPTY_NOTE_FORM);
    setNoteVitals(EMPTY_VITAL_SIGNS);
    setIsNoteOpen(false);
  };

  const save = async (andAnother: boolean) => {
    if (!isValid || isSaving) return;
    const vitals = parseVitalSigns(noteVitals);
    if (!vitals.ok) {
      setIsNoteOpen(true);
      toast.error(vitals.message);
      return;
    }
    setIsSaving(true);
    try {
      await recordPastVisit({
        patientId,
        serviceId,
        isoDate,
        time,
        paymentStatus: status,
        amount: isPaid ? parsedAmount : undefined,
        method: isPaid ? method : null,
        note,
        clinicalNote: { ...noteForm, vitalSigns: vitals.value },
      });
      toast.success("Cita pasada guardada");
      setSavedCount((n) => n + 1);
      resetForNext();
      await onSaved();
      if (!andAnother) onClose();
    } catch (error: unknown) {
      console.error(
        "[PastVisitModal] Error al guardar:",
        error instanceof Error ? error.message : error,
      );
      toast.error(
        error instanceof Error ? error.message : "No se pudo guardar la cita pasada.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const choiceClasses = (selected: boolean) =>
    `min-h-11 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-all cursor-pointer ${
      selected
        ? "border-brand-primary bg-brand-light/40 text-brand-dark"
        : "border-brand-light bg-white text-brand-gray hover:border-brand-primary/40"
    }`;
  const compactInputClasses = "!py-2.5 !px-3 !text-sm !rounded-lg";
  const compactLabelClasses =
    "[&>label]:!text-sm [&>label]:!font-bold [&>label]:!mb-0.5";

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Registrar cita pasada"
        icon={<History className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
        maxWidth="max-w-lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
          className="space-y-4 pb-2"
        >
          <p className="text-sm text-brand-gray">
            Para citas que ya ocurrieron. El cobro cuenta en Finanzas el día de
            la cita.
          </p>

          {catalog.status === "ready" ? (
            <>
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label
                    id="past-visit-patient-label"
                    className="text-brand-dark font-bold text-sm"
                  >
                    Paciente
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsNewPatientOpen(true)}
                    className="text-sm font-bold text-brand-primary hover:underline cursor-pointer min-h-11 px-2"
                  >
                    + Nuevo paciente
                  </button>
                </div>
                <Dropdown
                  labelledBy="past-visit-patient-label"
                  options={
                    catalog.patientOptions.length > 0
                      ? catalog.patientOptions
                      : [{ label: "No hay pacientes activos", value: "" }]
                  }
                  value={patientId}
                  onChange={setPatientId}
                  placeholder="Buscar por nombre..."
                  searchable={true}
                />
              </div>
              <div>
                <label
                  id="past-visit-service-label"
                  className="text-brand-dark font-bold text-sm mb-2 block"
                >
                  Servicio
                </label>
                <Dropdown
                  labelledBy="past-visit-service-label"
                  options={serviceOptions}
                  value={serviceId}
                  onChange={handleServiceChange}
                  placeholder="Seleccione un servicio..."
                />
              </div>
            </>
          ) : catalog.status === "error" ? (
            <div
              role="alert"
              className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700 flex items-center justify-between gap-3"
            >
              <span>{BOOKING_CATALOG_ERROR}</span>
              <button
                type="button"
                onClick={loadCatalog}
                className="shrink-0 px-3 py-2 min-h-11 rounded-lg bg-white border border-rose-200 text-rose-700 font-bold hover:bg-rose-100 transition-colors cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          ) : (
            <p
              role="status"
              className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-brand-gray"
            >
              Cargando pacientes y servicios...
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <label
                htmlFor="past-visit-date"
                className="text-brand-dark font-bold text-sm mb-2 block"
              >
                Fecha
              </label>
              <button
                id="past-visit-date"
                type="button"
                onClick={() => setIsDatePickerOpen(true)}
                className="w-full min-h-11 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left transition-all flex items-center justify-between gap-2 group cursor-pointer"
              >
                <span className="text-brand-dark first-letter:uppercase">
                  {formatVisitDate(isoDate)}
                </span>
                <CalendarIcon className="w-4 h-4 shrink-0 text-brand-gray group-hover:text-brand-primary transition-colors" />
              </button>
              <div className="absolute top-full mt-2 z-50">
                <DatePicker
                  isOpen={isDatePickerOpen}
                  onClose={() => setIsDatePickerOpen(false)}
                  selectedDate={isoDate}
                  maxDate={nowInClinic().isoDate}
                  allowPast
                  isDateDisabled={isClosedDay}
                  title="Fecha de la cita"
                  onSelectDate={(d) => {
                    setIsoDate(d);
                    setTime("");
                    setIsDatePickerOpen(false);
                  }}
                />
              </div>
            </div>
            <div>
              <label
                id="past-visit-time-label"
                className="text-brand-dark font-bold text-sm mb-2 block"
              >
                Hora
              </label>
              <Dropdown
                labelledBy="past-visit-time-label"
                options={
                  timeOptions.length > 0
                    ? timeOptions
                    : [{ label: "Sin horas libres que ya pasaron", value: "" }]
                }
                value={isTimeValid ? time : ""}
                onChange={setTime}
                placeholder="Seleccione una hora..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <p id="past-visit-paid-label" className="text-brand-dark font-bold text-sm">
              ¿Se cobró?
            </p>
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-labelledby="past-visit-paid-label"
            >
              <button
                type="button"
                role="radio"
                aria-checked={isPaid}
                onClick={() => setStatus("paid")}
                className={choiceClasses(isPaid)}
              >
                Sí
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!isPaid}
                onClick={() => setStatus("courtesy")}
                className={choiceClasses(!isPaid)}
              >
                Cortesía
              </button>
            </div>
          </div>

          {isPaid && (
            <>
              <Input
                label="Monto (MXN)"
                id="past-visit-amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onFocus={(e) => e.target.select()}
                containerClassName={`w-full ${compactLabelClasses}`}
                className={`min-h-11 ${compactInputClasses}`}
              />
              <div className="space-y-2">
                <p id="past-visit-method-label" className="text-brand-dark font-bold text-sm">
                  Método
                </p>
                <div
                  className="grid grid-cols-3 gap-2"
                  role="radiogroup"
                  aria-labelledby="past-visit-method-label"
                >
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={method === m}
                      onClick={() => setMethod(m)}
                      className={choiceClasses(method === m)}
                    >
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <Input
            label="Nota (opcional)"
            id="past-visit-note"
            type="text"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            containerClassName={`w-full ${compactLabelClasses}`}
            className={`min-h-11 ${compactInputClasses}`}
          />

          <div className="rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setIsNoteOpen((open) => !open)}
              aria-expanded={isNoteOpen}
              aria-controls="past-visit-clinical-note"
              className="w-full min-h-11 px-4 py-2.5 flex items-center justify-between gap-2 text-sm font-bold text-brand-dark cursor-pointer"
            >
              <span>Nota clínica (opcional)</span>
              {isNoteOpen ? (
                <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
            </button>
            {isNoteOpen && (
              <div id="past-visit-clinical-note" className="px-4 pb-4 space-y-4">
                <p className="text-sm text-brand-gray">
                  Queda abierta y marcada como registrada posteriormente. Podrás
                  completarla y cerrarla desde el expediente.
                </p>
                <div>
                  <p className="text-brand-dark font-bold text-sm mb-2">Signos vitales</p>
                  <VitalSignsFields value={noteVitals} onChange={setNoteVitals} disabled={isSaving} />
                </div>
                {NOTE_FIELDS.map(({ key, label, placeholder }) => (
                  <div key={key} className="flex flex-col">
                    <label
                      htmlFor={`past-visit-note-${key}`}
                      className="text-brand-dark font-bold text-sm block"
                    >
                      {label}
                    </label>
                    <AutoGrowTextarea
                      id={`past-visit-note-${key}`}
                      rows={2}
                      disabled={isSaving}
                      value={noteForm[key]}
                      onChange={(e) =>
                        setNoteForm((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      placeholder={placeholder}
                      className="mt-2 grow min-h-19.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {savedCount > 0 && (
            <p role="status" className="text-sm font-medium text-teal-700">
              {savedCount === 1
                ? "1 cita guardada."
                : `${savedCount} citas guardadas.`}
            </p>
          )}

          <div className="pt-4 mt-2 border-t border-brand-light flex flex-wrap gap-3 justify-end max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="px-6 py-2.5 min-h-11 cursor-pointer text-sm"
            >
              Cerrar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving || !isValid}
              onClick={() => void save(true)}
              className="px-6 py-2.5 min-h-11 cursor-pointer text-sm font-bold text-brand-primary border-brand-primary disabled:opacity-50"
            >
              Guardar y registrar otra
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !isValid}
              className="px-6 py-2.5 min-h-11 flex items-center justify-center gap-2 cursor-pointer text-sm disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Guardar cita pasada
            </Button>
          </div>
        </form>
      </Modal>

      <NewPatientModal
        isOpen={isOpen && isNewPatientOpen}
        onClose={() => setIsNewPatientOpen(false)}
        onCreated={(patient) => {
          loadCatalog();
          if (patient.id) setPatientId(patient.id);
          toast.success("Paciente creado");
        }}
      />
    </>
  );
};
