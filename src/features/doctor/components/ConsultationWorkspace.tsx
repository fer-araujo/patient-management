import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Save,
  User,
  Activity,
  Clock,
  FileText,
  Camera,
  Pill,
  FileDown,
  UploadCloud,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  Copy,
  StickyNote,
  Loader2,
  ZoomIn,
  ZoomOut,
  ClipboardList,
  Edit2,
  ChevronUp,
  Scale,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Dropdown } from "../../../components/ui/Dropdown";
import { type DashboardAppointment } from "../../../lib/services/clinicService";
import {
  ANONYMIZED_PATIENT_MESSAGE,
  BLOOD_TYPES,
  type DashboardPatient,
  type PatientBackgroundFields,
  type PatientDetails,
  fetchPatientDetails,
  fetchPatientNotes,
  updatePatientBackground,
  updatePatientNotes,
} from "../../../lib/services/patientService";
import {
  fetchPatientHistory,
  findConsultationDraft,
  saveSoapNote,
  savePrescription,
  finalizeConsultationWithPayment,
  type PatientClinicalHistory,
  type MedicationItem,
  type Prescription,
  type SoapNote,
  type VitalSigns,
} from "../../../lib/services/soapService";
import {
  EMPTY_VITAL_SIGNS,
  describeVitalSigns,
  parseVitalSigns,
  toVitalSignsForm,
  type VitalSignsForm,
} from "../utils/vitalSigns";
import { describeAgeAndSex } from "../utils/patientIdentity";
import {
  uploadPatientFile,
  getPatientFiles,
  type ClinicalFile,
} from "../../../lib/services/storageService";
import {
  CLINICAL_UPLOAD_ACCEPT,
  CLINICAL_UPLOAD_RULES_TEXT,
  validateClinicalFile,
} from "../../../lib/files/clinicalUploadRules";
import { PrescriptionDisclaimer } from "../../../components/legal/PrescriptionDisclaimer";
import { NoteAddenda } from "./NoteAddenda";
import { ChargeModal, type ChargeInput } from "./modals/ChargeModal";
import {
  getWeightTracking,
  setWeightTracking,
} from "../../../lib/services/bodyMeasurementService";
import { sexFromGender } from "../utils/bodyComposition";
import { WeightTrackingTab } from "./weight/WeightTrackingTab";
import { ConfirmDialog } from "./weight/ConfirmDialog";

interface ConsultationWorkspaceProps {
  appointment?: DashboardAppointment;
  patient?: DashboardPatient;
  onClose: () => void;
  onFinishConsultation?: (id: string) => void;
}

type WorkspaceTab = "notas" | "receta" | "fotos" | "peso";

interface WorkspaceTabDef {
  id: WorkspaceTab;
  label: string;
  icon: React.ElementType;
}

const WORKSPACE_TABS: WorkspaceTabDef[] = [
  { id: "notas", label: "Notas Clínicas (SOAP)", icon: FileText },
  { id: "receta", label: "Recetas e Indicaciones", icon: Pill },
  { id: "fotos", label: "Galería y Estudios", icon: Camera },
];

/** Shown only for patients with weight tracking on (patients.weight_tracking). */
const WEIGHT_TAB: WorkspaceTabDef = {
  id: "peso",
  label: "Control de peso",
  icon: Scale,
};

const FINALIZE_REQUIRES_MESSAGE =
  "Para finalizar la consulta, escribe el diagnóstico y el plan.";

type BackgroundKey = keyof PatientBackgroundFields;
type BackgroundTextKey = Exclude<BackgroundKey, "blood_type">;
type BackgroundForm = Record<BackgroundKey, string>;

/** Clinical background ("Antecedentes"), in this order. */
const BACKGROUND_FIELDS: { key: BackgroundKey; label: string }[] = [
  { key: "blood_type", label: "Tipo de sangre" },
  { key: "allergies", label: "Alergias" },
  { key: "chronic_conditions", label: "Enfermedades crónicas" },
  { key: "family_history", label: "Heredofamiliares" },
  { key: "personal_pathological_history", label: "Personales patológicos" },
  { key: "non_pathological_history", label: "Personales no patológicos" },
  { key: "current_illness", label: "Padecimiento actual" },
];

/**
 * Free-text background fields editable in the consultation. "Negados" is the
 * record's word for "asked, nothing to report"; the fields stay optional.
 */
const BACKGROUND_TEXT_FIELDS: {
  key: BackgroundTextKey;
  label: string;
  placeholder: string;
}[] = [
  { key: "allergies", label: "Alergias", placeholder: "Ej. Penicilina" },
  {
    key: "chronic_conditions",
    label: "Enfermedades crónicas",
    placeholder: "Ej. Diabetes",
  },
  { key: "family_history", label: "Heredofamiliares", placeholder: "Ej. Negados" },
  {
    key: "personal_pathological_history",
    label: "Personales patológicos",
    placeholder: "Ej. Negados",
  },
  {
    key: "non_pathological_history",
    label: "Personales no patológicos",
    placeholder: "Ej. Negados",
  },
  {
    key: "current_illness",
    label: "Padecimiento actual",
    placeholder: "Ej. Negados",
  },
];

const BLOOD_TYPE_OPTIONS = [
  ...BLOOD_TYPES.map((t) => ({ label: t.replace("-", "−"), value: t })),
  { label: "No sé", value: "" },
];

const BACKGROUND_SAVE_FAILED_MESSAGE =
  "No se pudieron guardar los antecedentes. Revisa tu conexión e intenta de nuevo.";

const toBackgroundForm = (details: PatientDetails): BackgroundForm => ({
  blood_type: details.blood_type ?? "",
  allergies: details.allergies ?? "",
  chronic_conditions: details.chronic_conditions ?? "",
  family_history: details.family_history ?? "",
  personal_pathological_history: details.personal_pathological_history ?? "",
  non_pathological_history: details.non_pathological_history ?? "",
  current_illness: details.current_illness ?? "",
});

const isEmptyBackground = (form: BackgroundForm) =>
  Object.values(form).every((value) => value.trim() === "");

/** "martes, 15 de octubre de 2026, 10:30 a.m." (NOM-004 5.10: date and time). */
const formatNoteDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const sameMedication = (a: MedicationItem, b: MedicationItem) =>
  a.nombre === b.nombre &&
  a.dosis === b.dosis &&
  a.indicaciones === b.indicaciones;

const supportsFieldSizing =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("field-sizing", "content");

/**
 * A textarea that grows with its text, so the page is the only scroll area
 * (no inner scrollbar). Uses `field-sizing: content` where the browser has it
 * and measures the text otherwise. Its minimum height comes from the caller's
 * `min-h-*` class; a `grow` class may stretch it further to fill its box.
 */
const AutoGrowTextarea = ({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { value } = props;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || supportsFieldSizing) return;
    const fit = () => {
      // Measure the text without any flex stretch, then let it stretch again.
      el.style.flexGrow = "0";
      el.style.height = "auto";
      const borders = el.offsetHeight - el.clientHeight;
      el.style.height = `${el.scrollHeight + borders}px`;
      el.style.flexGrow = "";
    };
    fit();
    // Width changes (window resize, browser zoom) rewrap the text.
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);

  return (
    <textarea
      ref={ref}
      {...props}
      className={`field-sizing-content overflow-hidden ${className}`}
    />
  );
};

/**
 * Height of the app's sticky header, so the consultation bar sticks right
 * below it instead of covering it. Follows browser zoom and text wrapping.
 */
const useStickyHeaderOffset = () => {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const header = document.querySelector("header");
    if (!header || getComputedStyle(header).position !== "sticky") return;
    const measure = () => setOffset(header.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return offset;
};

export const ConsultationWorkspace = ({
  appointment,
  patient,
  onClose,
  onFinishConsultation,
}: ConsultationWorkspaceProps) => {
  const isReviewMode = !appointment && !!patient;
  const targetId = appointment?.patientId || patient?.id || "";
  const targetName =
    appointment?.patientName || patient?.name || "Paciente Desconocido";
  const targetPhone = appointment?.phone || patient?.phone || "Sin teléfono";
  const isNewPatient = appointment
    ? appointment.isNewPatient
    : patient?.totalVisits === 0;

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("notas");
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [history, setHistory] = useState<PatientClinicalHistory | null>(null);

  const [viewingHistoricalNote, setViewingHistoricalNote] =
    useState<SoapNote | null>(null);
  const [globalNotes, setGlobalNotes] = useState(patient?.notes || "");
  // The reminders as last read from or saved to the database; they are only
  // written back when the doctor changed them.
  const [savedNotes, setSavedNotes] = useState(patient?.notes || "");
  const [loadFailed, setLoadFailed] = useState(false);

  const [patientDetails, setPatientDetails] = useState<PatientDetails | null>(
    null,
  );
  // Antecedentes are patient-level data: edited here, saved to the patient
  // (only what changed), never frozen with the note.
  const [backgroundForm, setBackgroundForm] = useState<BackgroundForm | null>(
    null,
  );
  const [savedBackground, setSavedBackground] =
    useState<BackgroundForm | null>(null);
  const [backgroundLoadFailed, setBackgroundLoadFailed] = useState(false);
  // The edit card in the notes area: opened on load for a first visit (no
  // background yet), otherwise only when the doctor presses Editar.
  const [isBackgroundOpen, setIsBackgroundOpen] = useState(false);

  // Starts empty: text the doctor did not write must never be frozen into
  // the record (NOM-004 5.11). A saved draft replaces this on load.
  const [soapNotes, setSoapNotes] = useState({
    subjetivo: "",
    objetivo: "",
    analisis: "",
    pronostico: "",
    plan: "",
  });

  const [vitalSigns, setVitalSigns] =
    useState<VitalSignsForm>(EMPTY_VITAL_SIGNS);
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [newMedication, setNewMedication] = useState<MedicationItem>({
    nombre: "",
    dosis: "",
    indicaciones: "",
  });
  const [localPrescriptions, setLocalPrescriptions] = useState<
    MedicationItem[]
  >([]);

  const [patientFiles, setPatientFiles] = useState<ClinicalFile[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isChargeOpen, setIsChargeOpen] = useState(false);

  // Weight tracking (InBody). Null until read (or when the read failed):
  // then neither the tab nor the "Llevar control de peso" button is shown.
  const [weightTracking, setWeightTrackingState] = useState<boolean | null>(
    null,
  );
  const [isTrackingConfirmOpen, setIsTrackingConfirmOpen] = useState(false);
  const [isTrackingBusy, setIsTrackingBusy] = useState(false);

  //ESTADO PARA EL ZOOM
  const [zoomLevel, setZoomLevel] = useState(100);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ left: 0, top: 0 });

  const appointmentId = appointment?.id;
  const stickyTop = useStickyHeaderOffset();

  useEffect(() => {
    let active = true;
    const loadWorkspaceData = async () => {
      setIsLoadingHistory(true);
      setLoadFailed(false);
      if (!targetId) {
        setLoadFailed(true);
        setIsLoadingHistory(false);
        return;
      }
      try {
        const [historyData, filesData, reminders] = await Promise.all([
          fetchPatientHistory(targetId),
          // Files are not needed to write the note: a failure only hides them.
          getPatientFiles(targetId).catch((err: unknown) => {
            console.error("Error cargando archivos:", err);
            toast.error("No se pudieron cargar las fotos y estudios.");
            return [] as ClinicalFile[];
          }),
          // A live consultation has no reminders in its props: read them, so
          // the draft save never writes an empty pad over them.
          appointmentId ? fetchPatientNotes(targetId) : Promise.resolve(null),
        ]);
        if (!active) return;
        setHistory(historyData);
        setPatientFiles(filesData);
        if (reminders !== null) {
          setGlobalNotes(reminders);
          setSavedNotes(reminders);
        }

        // AUTO-SELECCIONAR LA ÚLTIMA CITA EN MODO REVISIÓN
        if (isReviewMode && historyData.notes.length > 0) {
          setViewingHistoricalNote(historyData.notes[0]);
        }

        // Reopening an unfinished consultation continues its saved draft
        // instead of starting blank (and later overwriting it).
        if (appointmentId) {
          const draft = findConsultationDraft(historyData, appointmentId);
          if (draft.note) {
            setSoapNotes({
              subjetivo: draft.note.subjective ?? "",
              objetivo: draft.note.objective ?? "",
              analisis: draft.note.analysis ?? "",
              pronostico: draft.note.prognosis ?? "",
              plan: draft.note.plan ?? "",
            });
            setVitalSigns(toVitalSignsForm(draft.note.vitalSigns));
          }
          if (draft.prescription) {
            setLocalPrescriptions(draft.prescription.medications);
          }
        }
      } catch (err: unknown) {
        console.error("Error cargando datos del workspace:", err);
        if (active) setLoadFailed(true);
        toast.error(
          "Error al cargar el expediente. Cierra y vuelve a abrir la consulta.",
        );
      } finally {
        if (active) setIsLoadingHistory(false);
      }
    };
    loadWorkspaceData();
    return () => {
      active = false;
    };
  }, [targetId, isReviewMode, appointmentId]);

  // Age, sex and clinical background. Not critical: the consultation works
  // without them, so a failure only leaves those fields out.
  useEffect(() => {
    if (!targetId) return;
    let active = true;
    fetchPatientDetails(targetId)
      .then((details) => {
        if (!active) return;
        const form = toBackgroundForm(details);
        setPatientDetails(details);
        setBackgroundForm(form);
        setSavedBackground(form);
        setIsBackgroundOpen(isEmptyBackground(form));
      })
      .catch((err: unknown) => {
        console.error(
          "Error cargando datos del paciente:",
          err instanceof Error ? err.message : err,
        );
        if (active) setBackgroundLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [targetId]);

  // Not critical either: a failure only hides weight tracking.
  useEffect(() => {
    if (!targetId) return;
    let active = true;
    getWeightTracking(targetId)
      .then((on) => {
        if (active) setWeightTrackingState(on);
      })
      .catch((err: unknown) => {
        console.error(
          "Error cargando control de peso:",
          err instanceof Error ? err.message : err,
        );
      });
    return () => {
      active = false;
    };
  }, [targetId]);

  const ageAndSex = describeAgeAndSex(
    patientDetails?.dob ?? patient?.dob,
    patientDetails?.gender ?? patient?.gender,
  );

  const viewedVitalSigns = describeVitalSigns(
    viewingHistoricalNote?.vitalSigns ?? null,
  );

  // Follows what the doctor types, so the sidebar and the card agree.
  const backgroundItems = backgroundForm
    ? BACKGROUND_FIELDS.map(({ key, label }) => ({
        label,
        value: backgroundForm[key].trim(),
      })).filter((item) => item.value !== "")
    : [];

  // The draft of THIS consultation is edited above; it is not a past visit.
  const isCurrentDraft = (row: {
    appointmentId: string;
    finalizedAt: string | null;
  }) => !!appointmentId && row.appointmentId === appointmentId && !row.finalizedAt;
  const pastNotes = (history?.notes ?? []).filter((n) => !isCurrentDraft(n));
  const pastPrescriptions = (history?.prescriptions ?? []).filter(
    (p) => !isCurrentDraft(p) && p.medications.length > 0,
  );

  // Until the saved draft is in the editor nothing may be typed or saved:
  // text typed earlier would be replaced, or would overwrite the draft. If the
  // load failed the editor stays locked, since the draft is unknown.
  const isEditorLocked = !isReviewMode && (isLoadingHistory || loadFailed);

  const isAnonymized = !!patientDetails?.anonymized_at;
  // Weight tracking writes wait for the patient's details: until they are
  // read, "not anonymized" is unknown, not true.
  const canEditWeightTracking = patientDetails !== null && !isAnonymized;
  const canEditBackground = !isReviewMode && !isAnonymized;
  const isBackgroundLocked = isEditorLocked || backgroundForm === null;
  const hasNoBackground =
    savedBackground !== null && isEmptyBackground(savedBackground);
  // The sidebar card is the only place the background is read; the edit card
  // in the notes area exists only while it is being filled in or edited.
  const isBackgroundExpanded =
    canEditBackground && backgroundForm !== null && isBackgroundOpen;

  const visibleTabs = weightTracking
    ? [...WORKSPACE_TABS, WEIGHT_TAB]
    : WORKSPACE_TABS;
  const bodySex = sexFromGender(patientDetails?.gender ?? patient?.gender);

  /** "Llevar control de peso" (after confirmation): shows the tab. */
  const startWeightTracking = async () => {
    setIsTrackingBusy(true);
    try {
      await setWeightTracking(targetId, true);
      setWeightTrackingState(true);
      setIsTrackingConfirmOpen(false);
      setActiveTab("peso");
      toast.success("Listo: ya puedes registrar sus mediciones.");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo activar el control de peso.",
      );
    } finally {
      setIsTrackingBusy(false);
    }
  };

  /** "Dejar de llevar control": hides the tab; measurements are kept. */
  const stopWeightTracking = async () => {
    await setWeightTracking(targetId, false);
    setWeightTrackingState(false);
    setActiveTab("notas");
    toast.success("Se dejó de llevar el control de peso.");
  };

  const setBackgroundField = (key: BackgroundKey, value: string) =>
    setBackgroundForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  /**
   * Saves the antecedentes the doctor changed, if any. A failure rejects with
   * a clear message, so the caller keeps the doctor on this screen.
   */
  const saveBackground = async (patientId: string) => {
    if (!canEditBackground || !backgroundForm || !savedBackground) return;
    const snapshot = backgroundForm;
    const changes: Partial<PatientBackgroundFields> = {};
    for (const { key } of BACKGROUND_FIELDS) {
      if (snapshot[key] !== savedBackground[key]) changes[key] = snapshot[key];
    }
    if (Object.keys(changes).length === 0) return;
    try {
      await updatePatientBackground(patientId, changes);
    } catch (err: unknown) {
      console.error(
        "Error guardando antecedentes:",
        err instanceof Error ? err.message : err,
      );
      if (err instanceof Error && err.message === ANONYMIZED_PATIENT_MESSAGE) {
        // Anonymized meanwhile: read-only from now on, so a retry can still
        // save and finalize the note.
        setPatientDetails((prev) =>
          prev ? { ...prev, anonymized_at: new Date().toISOString() } : prev,
        );
        throw err;
      }
      throw new Error(BACKGROUND_SAVE_FAILED_MESSAGE);
    }
    setSavedBackground(snapshot);
  };

  /**
   * Content checks shared by the draft save and the finalize path. Returns
   * the vital signs to store, or the Spanish reason the consultation cannot
   * be saved as it is.
   */
  const checkConsultation = (
    finalize: boolean,
  ): { vitalSigns: VitalSigns | null } | { error: string } => {
    const vitals = parseVitalSigns(vitalSigns);
    if (!vitals.ok) return { error: vitals.message };
    if (finalize && (!soapNotes.analisis.trim() || !soapNotes.plan.trim())) {
      return { error: FINALIZE_REQUIRES_MESSAGE };
    }
    return { vitalSigns: vitals.value };
  };

  const reportCheck = (error: string) => {
    if (error === FINALIZE_REQUIRES_MESSAGE) setActiveTab("notas");
    toast.error(error);
  };

  /** Saves the editable consultation as a draft (never finalizes). */
  const persistDraft = async (vitals: VitalSigns | null) => {
    if (!appointment) return;
    await Promise.all([
      saveSoapNote(appointment.id, appointment.patientId, {
        subjective: soapNotes.subjetivo,
        objective: soapNotes.objetivo,
        analysis: soapNotes.analisis,
        plan: soapNotes.plan,
        prognosis: soapNotes.pronostico,
        vitalSigns: vitals,
      }),
      savePrescription(appointment.id, appointment.patientId, localPrescriptions),
      globalNotes !== savedNotes
        ? updatePatientNotes(appointment.patientId, globalNotes)
        : Promise.resolve(),
      saveBackground(appointment.patientId),
    ]);
    setSavedNotes(globalNotes);
  };

  /** Review mode: only the reminders can change. */
  const closeReview = async () => {
    setIsSaving(true);
    if (patient && globalNotes !== savedNotes) {
      try {
        await updatePatientNotes(patient.id, globalNotes);
        toast.success("Recordatorios actualizados.");
      } catch (e) {
        console.error(e);
        toast.error("Error al guardar recordatorios.");
      }
    }
    onClose();
  };

  // The back arrow saves a draft; only "Finalizar Consulta" freezes the note.
  // Finalizing is irreversible (NOM-004), so it must never happen by accident.
  const handleBackClick = async () => {
    if (isReviewMode) {
      await closeReview();
      return;
    }
    if (loadFailed) {
      // The draft was never loaded: saving would overwrite it.
      onClose();
      return;
    }
    const checked = checkConsultation(false);
    if ("error" in checked) {
      reportCheck(checked.error);
      return;
    }
    setIsSaving(true);
    try {
      await persistDraft(checked.vitalSigns);
      toast.success("Borrador guardado. Puedes continuar la consulta después.");
      onClose();
    } catch (err: unknown) {
      console.error("Error guardando consulta:", err);
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Hubo un error al guardar la consulta.",
      );
      setIsSaving(false);
    }
  };

  // A live consultation first asks whether it was charged. The content is
  // checked before that step, so nothing is asked for a note that cannot be
  // finalized yet.
  const handleFinishClick = () => {
    if (isReviewMode || !appointment) {
      closeReview();
      return;
    }
    const checked = checkConsultation(true);
    if ("error" in checked) {
      reportCheck(checked.error);
      return;
    }
    setIsChargeOpen(true);
  };

  /**
   * "Guardar y finalizar" in the charge step: saves the draft, then records
   * the charge and freezes the consultation in ONE database transaction. A
   * rejection propagates to the charge step, which shows it and stays open
   * for a retry; nothing was charged or frozen.
   */
  const finishWithCharge = async (charge: ChargeInput) => {
    if (!appointment) return;
    const checked = checkConsultation(true);
    if ("error" in checked) throw new Error(checked.error);

    setIsSaving(true);
    try {
      await persistDraft(checked.vitalSigns);
      await finalizeConsultationWithPayment(appointment.id, charge);
    } catch (err) {
      setIsSaving(false);
      throw err;
    }

    setIsChargeOpen(false);
    if (onFinishConsultation) {
      onFinishConsultation(appointment.id);
    } else {
      onClose();
    }
  };

  const handleAddPrescription = () => {
    if (newMedication.nombre) {
      setLocalPrescriptions([...localPrescriptions, { ...newMedication }]);
      setNewMedication({ nombre: "", dosis: "", indicaciones: "" });
      setIsPrescriptionModalOpen(false);
    }
  };

  /** "Copiar": reuse one past medication in today's prescription. */
  const handleCopyMedication = (med: MedicationItem) => {
    if (localPrescriptions.some((m) => sameMedication(m, med))) {
      toast("Ese medicamento ya está en la receta de hoy.");
      return;
    }
    setLocalPrescriptions([...localPrescriptions, { ...med }]);
    toast.success(`${med.nombre} copiado a la receta de hoy.`);
  };

  /** "Copiar todo": a whole past prescription, skipping what is already there. */
  const handleCopyPrescription = (pres: Prescription) => {
    const toAdd = pres.medications.filter(
      (med, i, all) =>
        !localPrescriptions.some((m) => sameMedication(m, med)) &&
        all.findIndex((other) => sameMedication(other, med)) === i,
    );
    if (toAdd.length === 0) {
      toast("Esos medicamentos ya están en la receta de hoy.");
      return;
    }
    setLocalPrescriptions([
      ...localPrescriptions,
      ...toAdd.map((med) => ({ ...med })),
    ]);
    toast.success(
      toAdd.length === 1
        ? "Se agregó 1 medicamento a la receta de hoy."
        : `Se agregaron ${toAdd.length} medicamentos a la receta de hoy.`,
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const selectedFiles = Array.from(e.target.files);
    const invalidMessage = selectedFiles
      .map(validateClinicalFile)
      .find((message) => message !== null);
    if (invalidMessage) {
      toast.error(invalidMessage, { duration: 8000 });
      e.target.value = "";
      return;
    }

    setIsUploadingFile(true);
    const loadingToast = toast.loading("Subiendo archivos...");

    try {
      const uploadPromises = selectedFiles.map((file) =>
        uploadPatientFile(targetId, file, "doctor"),
      );
      await Promise.all(uploadPromises);

      const newFilesData = await getPatientFiles(targetId);
      setPatientFiles(newFilesData);

      toast.success("Archivos subidos correctamente", { id: loadingToast });
    } catch (err) {
      console.error(err);
      toast.error("Error al subir los archivos", { id: loadingToast });
    } finally {
      setIsUploadingFile(false);
      e.target.value = "";
    }
  };

  // Función para cambiar de foto y resetear el zoom
  const handleChangePhoto = (newIndex: number) => {
    setPhotoViewerIndex(newIndex);
    setZoomLevel(100); // Resetea el zoom al cambiar de imagen
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imageContainerRef.current) return;
    setIsDragging(true);
    setDragStart({ x: e.pageX, y: e.pageY });
    setScrollStart({
      left: imageContainerRef.current.scrollLeft,
      top: imageContainerRef.current.scrollTop,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !imageContainerRef.current) return;
    e.preventDefault();
    const dx = e.pageX - dragStart.x;
    const dy = e.pageY - dragStart.y;
    imageContainerRef.current.scrollLeft = scrollStart.left - dx;
    imageContainerRef.current.scrollTop = scrollStart.top - dy;
  };

  const handleMouseUp = () => setIsDragging(false);

  const imageFiles = patientFiles.filter((f) => f.isImage);
  const docFiles = patientFiles.filter((f) => !f.isImage);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="min-h-screen bg-slate-50 pb-10 flex flex-col"
    >
      {/* The page is the only scroll area; this bar stays in view below the
          app header so "Finalizar Consulta" is always one click away. */}
      <div
        className="bg-white border-b border-slate-200 px-6 py-3 sticky z-40 shadow-sm flex items-center justify-between shrink-0"
        style={{ top: stickyTop }}
      >
        <div className="flex items-center gap-4">
          <button type="button"
            onClick={handleBackClick}
            disabled={isSaving || (!isReviewMode && isLoadingHistory)}
            aria-label="Guardar borrador y volver"
            className="p-2 rounded-xl hover:bg-slate-100 text-brand-gray transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              {!isReviewMode && (
                <span className="animate-pulse w-2 h-2 bg-rose-500 rounded-full"></span>
              )}
              <h2 className="text-base font-bold text-brand-dark leading-none truncate max-w-50 sm:max-w-xs">
                {isReviewMode ? "Revisión de Expediente" : "Consulta Activa"}
              </h2>
            </div>
            <p className="text-xs font-medium text-brand-gray mt-1 truncate">
              {isReviewMode
                ? "Solo lectura e historial"
                : `${appointment?.time} • ${appointment?.service}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button"
            onClick={handleFinishClick}
            disabled={isSaving || isEditorLocked}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-white cursor-pointer font-bold border-none shadow-sm text-sm whitespace-nowrap disabled:opacity-70 ${isReviewMode ? "bg-slate-800 hover:bg-slate-900" : "bg-teal-500 hover:bg-teal-600"}`}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Save className="w-4 h-4 shrink-0" />
            )}
            {isSaving
              ? "Guardando..."
              : isReviewMode
                ? "Cerrar Expediente"
                : "Finalizar Consulta"}
          </Button>
        </div>
      </div>

      <div className="max-w-360 mx-auto px-4 sm:px-6 pt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 w-full">
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-12 bg-brand-light/30"></div>
            <div className="w-16 h-16 bg-white border-4 border-white rounded-full mx-auto relative z-10 shadow-sm flex items-center justify-center text-brand-gray mt-1">
              <User className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-extrabold text-brand-dark mt-2 leading-tight">
              {targetName}
            </h3>
            <p className="text-sm font-medium text-brand-gray mt-0.5">
              {ageAndSex}
            </p>
            <p className="text-sm font-medium text-brand-gray mt-0.5">
              {targetPhone}
            </p>
            {weightTracking === false && canEditWeightTracking && (
              <button
                type="button"
                onClick={() => setIsTrackingConfirmOpen(true)}
                className="mt-3 w-full min-h-11 text-sm font-bold py-2 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center justify-center gap-1.5 cursor-pointer shadow-sm relative z-10"
              >
                <Scale className="w-4 h-4" /> Llevar control de peso
              </button>
            )}
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-brand-primary" />{" "}
                Antecedentes
              </h4>
              {canEditBackground && !isBackgroundExpanded && (
                <button
                  type="button"
                  onClick={() => setIsBackgroundOpen(true)}
                  disabled={backgroundForm === null}
                  className="text-xs font-bold py-2 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm"
                >
                  <Edit2 className="w-4 h-4" /> Editar
                </button>
              )}
            </div>
            {isAnonymized && (
              <p className="text-sm font-medium text-brand-gray mb-2">
                {ANONYMIZED_PATIENT_MESSAGE}
              </p>
            )}
            {backgroundLoadFailed ? (
              <p className="text-sm text-brand-gray italic text-center py-2">
                No se pudieron cargar los antecedentes.
              </p>
            ) : backgroundItems.length > 0 ? (
              <dl className="space-y-2">
                {backgroundItems.map((item) => (
                  <div key={item.label}>
                    <dt className="text-[10px] font-bold text-brand-gray uppercase">
                      {item.label}
                    </dt>
                    <dd className="text-sm font-medium text-brand-dark mt-0.5 whitespace-pre-wrap">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-brand-gray italic text-center py-2">
                Sin antecedentes registrados.
              </p>
            )}
          </div>

          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-400"></div>
            <h4 className="text-xs font-black text-amber-800 uppercase tracking-widest flex items-center gap-1.5 mb-2">
              <StickyNote className="w-4 h-4" /> Recordatorios Internos
            </h4>
            <AutoGrowTextarea
              value={globalNotes}
              disabled={isEditorLocked}
              onChange={(e) => setGlobalNotes(e.target.value)}
              placeholder="Anota detalles administrativos aquí..."
              className="w-full bg-amber-50/50 border-none text-base font-medium text-amber-900 focus:outline-none focus:ring-0 min-h-30 resize-none placeholder:text-amber-700/50 transition-colors"
            />
          </div>

          {!isReviewMode && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
              <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest flex items-center gap-1.5 mb-3">
                <Activity className="w-4 h-4 text-brand-primary" /> Signos
                Vitales
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <p className="text-[10px] font-bold text-brand-gray uppercase">
                    Presión arterial
                  </p>
                  <div className="flex items-center gap-1 mt-0.5 text-base font-bold text-brand-dark">
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="Presión sistólica"
                      disabled={isEditorLocked}
                      placeholder="—"
                      value={vitalSigns.bpSys}
                      onChange={(e) =>
                        setVitalSigns({
                          ...vitalSigns,
                          bpSys: e.target.value.replace(/\D/g, "").slice(0, 3),
                        })
                      }
                      className="w-8 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-brand-primary/30 rounded placeholder:font-normal placeholder:text-brand-dark/50"
                    />
                    <span className="text-slate-400">/</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="Presión diastólica"
                      disabled={isEditorLocked}
                      placeholder="—"
                      value={vitalSigns.bpDia}
                      onChange={(e) =>
                        setVitalSigns({
                          ...vitalSigns,
                          bpDia: e.target.value.replace(/\D/g, "").slice(0, 3),
                        })
                      }
                      className="w-8 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-brand-primary/30 rounded placeholder:font-normal placeholder:text-brand-dark/50"
                    />
                  </div>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <p className="text-[10px] font-bold text-brand-gray uppercase">
                    Oxigenación (%)
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Oxigenación"
                      disabled={isEditorLocked}
                    placeholder="—"
                    value={vitalSigns.spo2}
                    onChange={(e) =>
                      setVitalSigns({
                        ...vitalSigns,
                        spo2: e.target.value.replace(/\D/g, "").slice(0, 3),
                      })
                    }
                    className="w-full bg-transparent text-base font-bold text-brand-dark focus:outline-none mt-0.5 placeholder:font-normal placeholder:text-brand-dark/50"
                  />
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <p className="text-[10px] font-bold text-brand-gray uppercase">
                    Peso (kg)
                  </p>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Peso"
                      disabled={isEditorLocked}
                    placeholder="—"
                    value={vitalSigns.weight}
                    onChange={(e) =>
                      setVitalSigns({
                        ...vitalSigns,
                        weight: e.target.value.replace(/[^\d.]/g, "").slice(0, 5),
                      })
                    }
                    className="w-full bg-transparent text-base font-bold text-brand-dark focus:outline-none mt-0.5 placeholder:font-normal placeholder:text-brand-dark/50"
                  />
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <p className="text-[10px] font-bold text-brand-gray uppercase">
                    Talla (cm)
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Talla"
                      disabled={isEditorLocked}
                    placeholder="Opcional"
                    value={vitalSigns.height}
                    onChange={(e) =>
                      setVitalSigns({
                        ...vitalSigns,
                        height: e.target.value.replace(/\D/g, "").slice(0, 3),
                      })
                    }
                    className="w-full bg-transparent text-base font-bold text-brand-dark focus:outline-none mt-0.5 placeholder:font-normal placeholder:text-brand-dark/50"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest flex items-center gap-1.5 mb-3">
              <Clock className="w-4 h-4 text-brand-primary" /> Historial de
              Visitas
            </h4>
            {isLoadingHistory ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin text-brand-primary opacity-50" />
              </div>
            ) : pastNotes.length > 0 ? (
              <div className="space-y-4 mt-2">
                {pastNotes.map((note, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      if (isReviewMode) {
                        setViewingHistoricalNote(note);
                        setActiveTab("notas");
                      }
                    }}
                    className={`flex items-start gap-3 relative group ${isReviewMode ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 relative z-10 transition-all ${viewingHistoricalNote?.id === note.id ? "bg-brand-primary scale-150" : "bg-slate-300 group-hover:bg-brand-primary"}`}
                    ></div>
                    {idx !== pastNotes.length - 1 && (
                      <div className="absolute left-0.75 top-3.5 -bottom-5 w-0.5 bg-slate-100"></div>
                    )}
                    <div>
                      <p
                        className={`text-sm font-bold transition-colors line-clamp-1 ${viewingHistoricalNote?.id === note.id ? "text-brand-primary" : "text-brand-dark group-hover:text-brand-primary"}`}
                      >
                        {note.analysis || "Visita de rutina"}
                      </p>
                      <p className="text-xs font-medium text-brand-gray mt-0.5">
                        {new Date(note.createdAt).toLocaleDateString("es-MX")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-brand-gray italic text-center py-2">
                No hay visitas previas.
              </p>
            )}
          </div>
        </div>

        {/* Natural height, stretched by the grid row to at least the left
            column's height; the notes fill that space (Plan grows). */}
        <div className="lg:col-span-9 bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
          <div className="flex border-b border-slate-200 bg-slate-50/80 px-2 pt-2 overflow-x-auto hide-scrollbar shrink-0">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${activeTab === tab.id ? "border-brand-primary text-brand-primary bg-white rounded-t-xl" : "border-transparent text-brand-gray hover:text-brand-dark hover:bg-slate-100 rounded-t-xl"}`}
                >
                  <Icon className="w-4 h-4 shrink-0" /> {tab.label}
                </button>
              );
            })}
          </div>

          <div className="grow flex flex-col p-6">
            {activeTab === "notas" && (
              <div className="flex flex-col grow gap-5">
                {isReviewMode ? (
                  viewingHistoricalNote ? (
                    <>
                      <div className="bg-brand-light/10 border border-brand-primary/20 rounded-xl p-4 mb-2 flex items-center justify-between">
                        <div>
                          <h3 className="font-bold text-brand-dark text-base">
                            Mostrando expediente del:{" "}
                            {formatNoteDateTime(viewingHistoricalNote.createdAt)}
                          </h3>
                          <p className="text-sm font-medium text-brand-gray mt-0.5">
                            {targetName} · {ageAndSex}
                          </p>
                          <p className="text-sm font-medium text-brand-gray mt-0.5">
                            {viewingHistoricalNote.authorName
                              ? `Escrita por ${viewingHistoricalNote.authorName}`
                              : "Autor no registrado"}
                          </p>
                        </div>
                        <span className="text-xs font-bold bg-brand-light/30 text-brand-primary px-3 py-1.5 rounded uppercase tracking-wider">
                          Solo Lectura
                        </span>
                      </div>
                      {viewedVitalSigns.length > 0 && (
                        <div>
                          <p className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
                            Signos vitales
                          </p>
                          <ul className="mt-2 px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 leading-relaxed">
                            {viewedVitalSigns.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="flex flex-col h-full">
                          <label
                            htmlFor="note-view-subjective"
                            className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                          >
                            S - Motivo y Síntomas
                          </label>
                          <AutoGrowTextarea
                            id="note-view-subjective"
                            readOnly
                            value={viewingHistoricalNote.subjective || "Sin registro"}
                            className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                        <div className="flex flex-col h-full">
                          <label
                            htmlFor="note-view-objective"
                            className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                          >
                            O - Exploración Física
                          </label>
                          <AutoGrowTextarea
                            id="note-view-objective"
                            readOnly
                            value={viewingHistoricalNote.objective || "Sin registro"}
                            className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="flex flex-col h-full">
                          <label
                            htmlFor="note-view-analysis"
                            className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                          >
                            A - Diagnóstico (Análisis)
                          </label>
                          <AutoGrowTextarea
                            id="note-view-analysis"
                            readOnly
                            value={viewingHistoricalNote.analysis || "Sin registro"}
                            className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                        <div className="flex flex-col h-full">
                          <label
                            htmlFor="note-view-prognosis"
                            className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                          >
                            Pronóstico
                          </label>
                          <AutoGrowTextarea
                            id="note-view-prognosis"
                            readOnly
                            value={viewingHistoricalNote.prognosis || "Sin registro"}
                            className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col grow">
                        <div className="flex flex-col grow">
                          <label
                            htmlFor="note-view-plan"
                            className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                          >
                            P - Tratamiento (Plan)
                          </label>
                          <AutoGrowTextarea
                            id="note-view-plan"
                            readOnly
                            value={viewingHistoricalNote.plan || "Sin registro"}
                            className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                      <NoteAddenda
                        key={viewingHistoricalNote.id}
                        note={viewingHistoricalNote}
                        onAdded={(addendum) => {
                          const withAddendum = (n: SoapNote): SoapNote =>
                            n.id === addendum.noteId
                              ? { ...n, addenda: [...n.addenda, addendum] }
                              : n;
                          setViewingHistoricalNote((prev) =>
                            prev ? withAddendum(prev) : prev,
                          );
                          setHistory((prev) =>
                            prev
                              ? { ...prev, notes: prev.notes.map(withAddendum) }
                              : prev,
                          );
                        }}
                      />
                    </>
                  ) : (
                    <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200 my-auto">
                      <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                      <h3 className="text-xl font-bold text-brand-dark">
                        Modo de Solo Lectura
                      </h3>
                      <p className="text-base text-brand-gray max-w-md mx-auto mt-2">
                        Cuando se registren notas clínicas en futuras citas,
                        aparecerán aquí. Haz clic en las fechas del{" "}
                        <strong>Historial de Visitas</strong> en el panel
                        izquierdo para navegar entre ellas.
                      </p>
                    </div>
                  )
                ) : (
                  <>
                    {isBackgroundExpanded && backgroundForm && (
                      <section
                        aria-labelledby="background-title"
                        className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h4
                            id="background-title"
                            className="text-xs font-black text-brand-gray uppercase tracking-widest flex items-center gap-1.5"
                          >
                            <ClipboardList className="w-4 h-4 text-brand-primary" />{" "}
                            Antecedentes
                          </h4>
                          {/* Closing keeps the edits: they are saved with
                              Guardar or Finalizar, as before. */}
                          <button
                            type="button"
                            onClick={() => setIsBackgroundOpen(false)}
                            className="text-xs font-bold py-2 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm"
                          >
                            <ChevronUp className="w-4 h-4" /> Listo
                          </button>
                        </div>
                        {hasNoBackground && (
                          <p className="text-sm font-medium text-brand-gray mt-0.5">
                            Primera consulta: pregunta y registra sus antecedentes.
                          </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
                          <div>
                            <span
                              id="background-blood_type"
                              className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                            >
                              Tipo de sangre
                            </span>
                            <div className="mt-2">
                              <Dropdown
                                labelledBy="background-blood_type"
                                options={
                                  isBackgroundLocked
                                    ? BLOOD_TYPE_OPTIONS.map((o) => ({
                                        ...o,
                                        disabled: true,
                                      }))
                                    : BLOOD_TYPE_OPTIONS
                                }
                                value={backgroundForm.blood_type}
                                onChange={(val) =>
                                  setBackgroundField("blood_type", val)
                                }
                                className="py-0! text-sm!"
                              />
                            </div>
                          </div>
                          {BACKGROUND_TEXT_FIELDS.map(
                            ({ key, label, placeholder }) => (
                              <div key={key} className="flex flex-col">
                                <label
                                  htmlFor={`background-${key}`}
                                  className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                                >
                                  {label}
                                </label>
                                <AutoGrowTextarea
                                  id={`background-${key}`}
                                  rows={2}
                                  disabled={isBackgroundLocked}
                                  value={backgroundForm[key]}
                                  onChange={(e) =>
                                    setBackgroundField(key, e.target.value)
                                  }
                                  placeholder={placeholder}
                                  className="mt-2 grow min-h-19.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                                />
                              </div>
                            ),
                          )}
                        </div>
                      </section>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="flex flex-col h-full">
                        <label
                          htmlFor="note-subjective"
                          className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                        >
                          S - Motivo y Síntomas
                        </label>
                        <AutoGrowTextarea
                          id="note-subjective"
                          disabled={isEditorLocked}
                          value={soapNotes.subjetivo}
                          onChange={(e) =>
                            setSoapNotes({ ...soapNotes, subjetivo: e.target.value })
                          }
                          placeholder={
                            isNewPatient
                              ? "¿Por qué viene el paciente?"
                              : "Ej. Acude a revisión. Refiere..."
                          }
                          className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                        />
                      </div>
                      <div className="flex flex-col h-full">
                        <label
                          htmlFor="note-objective"
                          className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                        >
                          O - Exploración Física
                        </label>
                        <AutoGrowTextarea
                          id="note-objective"
                          disabled={isEditorLocked}
                          value={soapNotes.objetivo}
                          onChange={(e) =>
                            setSoapNotes({ ...soapNotes, objetivo: e.target.value })
                          }
                          placeholder="¿Qué observas?"
                          className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="flex flex-col h-full">
                        <label
                          htmlFor="note-analysis"
                          className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                        >
                          A - Diagnóstico (Análisis)
                        </label>
                        <AutoGrowTextarea
                          id="note-analysis"
                          disabled={isEditorLocked}
                          value={soapNotes.analisis}
                          onChange={(e) =>
                            setSoapNotes({ ...soapNotes, analisis: e.target.value })
                          }
                          placeholder="Ej. Paciente sano, sin hallazgos"
                          className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                        />
                      </div>
                      <div className="flex flex-col h-full">
                        <label
                          htmlFor="note-prognosis"
                          className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                        >
                          Pronóstico
                        </label>
                        <AutoGrowTextarea
                          id="note-prognosis"
                          disabled={isEditorLocked}
                          value={soapNotes.pronostico}
                          onChange={(e) =>
                            setSoapNotes({ ...soapNotes, pronostico: e.target.value })
                          }
                          placeholder="Ej. Favorable"
                          className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                        />
                      </div>
                    </div>
                    {/* Plan takes the card's remaining height: no empty band
                        below it when the left column is taller. */}
                    <div className="flex flex-col grow">
                      <div className="flex flex-col grow">
                        <label
                          htmlFor="note-plan"
                          className="text-brand-dark font-bold text-sm uppercase tracking-wider block"
                        >
                          P - Tratamiento (Plan)
                        </label>
                        <AutoGrowTextarea
                          id="note-plan"
                          disabled={isEditorLocked}
                          value={soapNotes.plan}
                          onChange={(e) =>
                            setSoapNotes({ ...soapNotes, plan: e.target.value })
                          }
                          placeholder="Ej. Alta · Sin tratamiento · Revisión en 6 meses"
                          className="mt-2 grow min-h-32.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "receta" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-lg font-bold text-brand-dark">
                      Registro de Recetas
                    </h3>
                    <p className="text-sm text-brand-gray mt-0.5">
                      Medicamentos indicados al paciente.
                    </p>
                  </div>
                  {!isReviewMode && (
                    <Button type="button"
                      onClick={() => setIsPrescriptionModalOpen(true)}
                      disabled={isEditorLocked}
                      className="w-full sm:w-auto px-5 py-3 text-sm rounded-lg cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2"
                    >
                      <Plus className="w-5 h-5" /> Nueva Indicación
                    </Button>
                  )}
                </div>

                <PrescriptionDisclaimer />

                {localPrescriptions.length > 0 ||
                pastPrescriptions.length > 0 ? (
                  <div className="space-y-4">
                    {localPrescriptions.map((med, idx) => (
                      <div
                        key={`local-${idx}`}
                        className="bg-brand-light/10 border border-brand-primary/30 p-5 rounded-xl flex items-start justify-between"
                      >
                        <div>
                          <p className="text-base font-bold text-brand-dark">
                            {med.nombre}{" "}
                            <span className="text-brand-primary font-medium">
                              ({med.dosis})
                            </span>
                          </p>
                          <p className="text-base text-brand-gray mt-1">
                            {med.indicaciones}
                          </p>
                          <span className="text-xs font-bold text-brand-primary mt-2 block">
                            Emitida: HOY
                          </span>
                        </div>
                      </div>
                    ))}
                    {pastPrescriptions.map((pres) => {
                      const issuedOn = new Date(pres.createdAt).toLocaleDateString(
                        "es-MX",
                      );
                      return (
                        <section
                          key={`hist-${pres.id}`}
                          aria-label={`Receta del ${issuedOn}`}
                          className="space-y-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-bold text-slate-400 block">
                              Receta del {issuedOn}
                            </span>
                            {!isReviewMode && (
                              <button
                                type="button"
                                onClick={() => handleCopyPrescription(pres)}
                                disabled={isEditorLocked}
                                aria-label={`Copiar toda la receta del ${issuedOn}`}
                                className="text-xs font-bold py-2 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm"
                              >
                                <Copy className="w-4 h-4" /> Copiar todo
                              </button>
                            )}
                          </div>
                          {pres.medications.map((med, mIdx) => (
                            <div
                              key={`hist-${pres.id}-${mIdx}`}
                              className="bg-slate-50 border border-slate-200 p-5 rounded-xl flex items-start justify-between transition-colors"
                            >
                              <div className="flex-1 pr-4">
                                <p className="text-base font-bold text-brand-dark">
                                  {med.nombre}{" "}
                                  <span className="text-brand-gray font-medium">
                                    ({med.dosis})
                                  </span>
                                </p>
                                <p className="text-sm text-brand-gray mt-1 line-clamp-1">
                                  {med.indicaciones}
                                </p>
                              </div>
                              {!isReviewMode && (
                                <button
                                  type="button"
                                  onClick={() => handleCopyMedication(med)}
                                  disabled={isEditorLocked}
                                  aria-label={`Copiar ${med.nombre} a la receta de hoy`}
                                  className="text-xs font-bold py-2 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm"
                                >
                                  <Copy className="w-4 h-4" /> Copiar
                                </button>
                              )}
                            </div>
                          ))}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <Pill className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-base font-medium text-brand-gray">
                      No hay recetas previas en el historial.
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "peso" && weightTracking && (
              <WeightTrackingTab
                key={targetId}
                patientId={targetId}
                patientName={targetName}
                sex={bodySex}
                appointment={
                  appointment?.isoDate
                    ? { id: appointment.id, date: appointment.isoDate }
                    : undefined
                }
                prefill={
                  isReviewMode
                    ? undefined
                    : { weight: vitalSigns.weight, height: vitalSigns.height }
                }
                readOnly={!canEditWeightTracking}
                onStopTracking={stopWeightTracking}
              />
            )}

            {activeTab === "fotos" && (
              <div className="space-y-8">
                <label
                  className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-colors cursor-pointer group ${isUploadingFile ? "border-slate-300 bg-slate-50 pointer-events-none opacity-60" : "border-brand-primary/30 bg-brand-light/5 hover:bg-brand-light/10"}`}
                >
                  <input
                    type="file"
                    multiple
                    accept={CLINICAL_UPLOAD_ACCEPT}
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={isUploadingFile}
                  />
                  <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-brand-primary shadow-sm mb-3 group-hover:scale-110 transition-transform">
                    {isUploadingFile ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (
                      <UploadCloud className="w-6 h-6" />
                    )}
                  </div>
                  <p className="text-base font-bold text-brand-dark">
                    {isUploadingFile
                      ? "Subiendo archivos..."
                      : "Sube fotos o estudios a este expediente"}
                  </p>
                  <p className="text-sm text-brand-gray mt-1">
                    {CLINICAL_UPLOAD_RULES_TEXT}
                  </p>
                </label>

                {isLoadingHistory ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-primary opacity-50" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    {docFiles.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-brand-gray uppercase tracking-widest mb-3 pb-2 border-b border-slate-100 flex items-center gap-2">
                          <FileText className="w-4 h-4" /> Estudios y Documentos
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          {docFiles.map((file, i) => (
                            <a
                              key={i}
                              href={file.url}
                              target="_blank"
                              rel="norenoopener noreferrer"
                              className="aspect-square bg-slate-100 rounded-xl border border-slate-200 flex flex-col items-center justify-center p-3 text-center hover:border-brand-primary hover:shadow-md transition-all cursor-pointer group"
                            >
                              <FileDown className="w-10 h-10 text-brand-primary mb-3 group-hover:-translate-y-1 transition-transform" />
                              <span
                                className="text-xs font-bold text-slate-600 w-full line-clamp-2"
                                title={file.originalName}
                              >
                                {file.originalName}
                              </span>
                              <span className="text-[10px] text-slate-400 mt-1">
                                {new Date(file.createdAt).toLocaleDateString(
                                  "es-MX",
                                )}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {imageFiles.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-brand-gray uppercase tracking-widest mb-3 pb-2 border-b border-slate-100 flex items-center gap-2">
                          <Camera className="w-4 h-4" /> Historial Fotográfico
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          {imageFiles.map((file, index) => (
                            <div
                              key={index}
                              onClick={() => setPhotoViewerIndex(index)}
                              className="aspect-square bg-slate-100 rounded-xl border border-slate-200 overflow-hidden relative group cursor-pointer flex flex-col items-center justify-center"
                            >
                              <img
                                src={file.url}
                                alt={file.originalName}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-brand-dark/0 group-hover:bg-brand-dark/40 transition-colors flex items-center justify-center">
                                <Search className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity scale-75 group-hover:scale-100" />
                              </div>
                              <span className="absolute bottom-2 left-2 right-2 text-[10px] font-bold text-white bg-black/60 px-2 py-1 rounded truncate backdrop-blur-sm text-center">
                                {new Date(file.createdAt).toLocaleDateString(
                                  "es-MX",
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {docFiles.length === 0 && imageFiles.length === 0 && (
                      <p className="text-sm text-brand-gray italic text-center py-6">
                        No hay archivos en este expediente.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {appointment && (
        <ChargeModal
          key={appointment.id}
          isOpen={isChargeOpen}
          onClose={() => setIsChargeOpen(false)}
          onConfirm={finishWithCharge}
          appointmentId={appointment.id}
          subtitle={`${targetName} · ${appointment.service}`}
          servicePrice={appointment.servicePrice}
          withSupplies
          serviceId={appointment.serviceId}
          confirmLabel="Guardar y finalizar"
        />
      )}

      <ConfirmDialog
        isOpen={isTrackingConfirmOpen}
        onClose={() => setIsTrackingConfirmOpen(false)}
        onConfirm={startWeightTracking}
        isBusy={isTrackingBusy}
        title="Control de peso"
        icon={<Scale className="w-8 h-8" strokeWidth={2.5} />}
        question={`¿Llevar el control de peso de ${targetName}?`}
        description="Aparecerá la pestaña «Control de peso» para registrar sus mediciones de la báscula InBody."
        confirmLabel="Sí, llevar control"
      />

      <Modal
        isOpen={isPrescriptionModalOpen}
        onClose={() => setIsPrescriptionModalOpen(false)}
        title="Nueva Indicación Médica"
        icon={<Pill className="w-6 h-6 text-brand-primary" />}
        hideFooter={true}
      >
        <div className="space-y-5 pb-2">
          <div>
            <label className="text-brand-dark font-bold text-base mb-2 block">
              Nombre del Medicamento
            </label>
            <input
              type="text"
              value={newMedication.nombre}
              onChange={(e) =>
                setNewMedication({ ...newMedication, nombre: e.target.value })
              }
              placeholder="Ej. Ibuprofeno..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:border-brand-primary outline-none"
            />
          </div>
          <div>
            <label className="text-brand-dark font-bold text-base mb-2 block">
              Dosis y Presentación
            </label>
            <input
              type="text"
              value={newMedication.dosis}
              onChange={(e) =>
                setNewMedication({ ...newMedication, dosis: e.target.value })
              }
              placeholder="Ej. 400mg, 1 Tableta..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:border-brand-primary outline-none"
            />
          </div>
          <div>
            <label className="text-brand-dark font-bold text-base mb-2 block">
              Indicaciones / Frecuencia
            </label>
            <textarea
              value={newMedication.indicaciones}
              onChange={(e) =>
                setNewMedication({
                  ...newMedication,
                  indicaciones: e.target.value,
                })
              }
              placeholder="Ej. 1 tableta vía oral cada 8 h por 5 días"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:border-brand-primary outline-none resize-none h-32"
            />
          </div>
          <div className="pt-4 border-t border-slate-100 flex gap-3 mt-4">
            <Button type="button"
              variant="outline"
              onClick={() => setIsPrescriptionModalOpen(false)}
              className="flex-1 py-4 rounded-xl cursor-pointer text-base"
            >
              Cancelar
            </Button>
            <Button type="button"
              onClick={handleAddPrescription}
              disabled={!newMedication.nombre}
              className="flex-1 py-4 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md disabled:opacity-50 cursor-pointer text-base font-bold"
            >
              Añadir a la Receta
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={photoViewerIndex !== null}
        onClose={() => {
          setPhotoViewerIndex(null);
          setZoomLevel(100); // Reseteamos el zoom al cerrar
        }}
        title="Visor de Imagen y Estudios"
        hideFooter={true}
        maxWidth="max-w-5xl" // <- El ancho extra que definimos en tu Modal.tsx
      >
        {photoViewerIndex !== null && imageFiles[photoViewerIndex] && (
          <div className="flex flex-col bg-white rounded-2xl min-h-[60vh] border border-slate-200 relative p-0 -mt-2 -mx-2 -mb-4 overflow-hidden shadow-inner">
            {/* BARRA DE HERRAMIENTAS FLOTANTE (ZOOM) */}
            <div className="absolute top-4 right-4 z-20 flex bg-white/90 backdrop-blur-md rounded-xl shadow-md border border-slate-200 p-1">
              <button type="button"
                onClick={() => setZoomLevel((prev) => Math.max(50, prev - 25))}
                className="p-2 hover:bg-slate-100 text-brand-dark rounded-lg transition-colors cursor-pointer"
                title="Alejar"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <button type="button"
                onClick={() => setZoomLevel(100)}
                className="px-3 hover:bg-slate-100 text-brand-dark font-bold text-xs rounded-lg transition-colors cursor-pointer w-14 text-center"
                title="Restaurar tamaño"
              >
                {zoomLevel}%
              </button>
              <button type="button"
                onClick={() => setZoomLevel((prev) => Math.min(300, prev + 25))}
                className="p-2 hover:bg-slate-100 text-brand-dark rounded-lg transition-colors cursor-pointer"
                title="Acercar"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
            </div>

            {/* BOTÓN ANTERIOR */}
            <button type="button"
              onClick={() =>
                handleChangePhoto(
                  (photoViewerIndex - 1 + imageFiles.length) %
                    imageFiles.length,
                )
              }
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/80 hover:bg-white text-brand-dark shadow-lg border border-slate-200 rounded-full transition-all cursor-pointer z-20"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {/* CONTENEDOR DE LA IMAGEN CON SCROLL Y DRAG */}
            <div
              ref={imageContainerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={`w-full h-[60vh] overflow-auto bg-slate-50/50 select-none ${zoomLevel > 100 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"}`}
              style={{
                backgroundImage:
                  "radial-gradient(#e2e8f0 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            >
              <div
                className={`min-w-full min-h-full flex p-4 transition-all duration-200 ease-in-out pointer-events-none
                  ${zoomLevel > 100 ? "items-start justify-start" : "items-center justify-center"}
                `}
              >
                <img
                  src={imageFiles[photoViewerIndex].url}
                  alt={imageFiles[photoViewerIndex].originalName}
                  style={{
                    width: zoomLevel === 100 ? "auto" : `${zoomLevel}%`,
                    maxWidth: zoomLevel === 100 ? "100%" : "none",
                    maxHeight: zoomLevel === 100 ? "55vh" : "none",
                  }}
                  className="object-contain rounded-md shadow-sm transition-all duration-200 ease-in-out pointer-events-none"
                  draggable={false}
                />
              </div>
            </div>

            {/* BOTÓN SIGUIENTE */}
            <button type="button"
              onClick={() =>
                handleChangePhoto((photoViewerIndex + 1) % imageFiles.length)
              }
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/80 hover:bg-white text-brand-dark shadow-lg border border-slate-200 rounded-full transition-all cursor-pointer z-20"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            {/* PIE DE FOTO (INFO) */}
            <div className="absolute bottom-0 w-full bg-white/90 backdrop-blur-md border-t border-slate-200 p-4 flex justify-between items-center z-20">
              <div>
                <p className="text-sm font-bold text-brand-dark">
                  {imageFiles[photoViewerIndex].originalName}
                </p>
                <p className="text-xs text-brand-gray mt-0.5">
                  Subida el{" "}
                  {new Date(
                    imageFiles[photoViewerIndex].createdAt,
                  ).toLocaleDateString("es-MX")}
                </p>
              </div>
              <span className="text-xs font-bold bg-brand-light/30 text-brand-primary px-3 py-1.5 rounded-lg uppercase tracking-wider">
                Foto {photoViewerIndex + 1} de {imageFiles.length}
              </span>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};
