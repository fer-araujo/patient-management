import { useState, useEffect } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { type DashboardAppointment } from "../../../lib/services/clinicService";
import {
  type DashboardPatient,
  updatePatientNotes,
} from "../../../lib/services/patientService";
import {
  fetchPatientHistory,
  saveSoapNote,
  savePrescription,
  type PatientClinicalHistory,
  type MedicationItem,
  type SoapNote,
} from "../../../lib/services/soapService";

interface ConsultationWorkspaceProps {
  appointment?: DashboardAppointment;
  patient?: DashboardPatient;
  onClose: () => void;
  onFinishConsultation?: (id: string) => void;
}

type WorkspaceTab = "notas" | "receta" | "fotos";

const WORKSPACE_TABS: {
  id: WorkspaceTab;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "notas", label: "Notas Clínicas (SOAP)", icon: FileText },
  { id: "receta", label: "Recetas e Indicaciones", icon: Pill },
  { id: "fotos", label: "Galería y Estudios", icon: Camera },
];

const MOCK_PATIENT_PHOTOS = ["Rostro_Frente.jpg", "Rostro_Perfil_Derecho.jpg"];

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

  // Estado para ver una nota histórica en modo revisión
  const [viewingHistoricalNote, setViewingHistoricalNote] =
    useState<SoapNote | null>(null);

  // ESTADO: POST-IT PERMANENTE (patients.notes)
  const [globalNotes, setGlobalNotes] = useState(patient?.notes || "");

  const [soapNotes, setSoapNotes] = useState({
    subjetivo: isNewPatient ? "" : "Acude a revisión. Refiere...",
    objetivo: "",
    analisis: "",
    plan: "",
  });

  const [vitalSigns, setVitalSigns] = useState({ peso: "", sys: "", dia: "" });

  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [newMedication, setNewMedication] = useState<MedicationItem>({
    nombre: "",
    dosis: "",
    indicaciones: "",
  });
  const [localPrescriptions, setLocalPrescriptions] = useState<
    MedicationItem[]
  >([]);

  const [localFiles, setLocalFiles] = useState<string[]>([]);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);

  // FIX: Solo un estado de guardado, sin pantalla verde.
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadHistory = async () => {
      if (!targetId) return;
      setIsLoadingHistory(true);
      try {
        const data = await fetchPatientHistory(targetId);
        setHistory(data);
      } catch (err: unknown) {
        console.error(
          "Error cargando historial:",
          err instanceof Error ? err.message : err,
        );
      } finally {
        setIsLoadingHistory(false);
      }
    };
    loadHistory();
  }, [targetId]);

  // FIX: Unificamos el guardado para la flecha de atrás y el botón de finalizar
  const handleFinishClick = async () => {
    setIsSaving(true);

    if (isReviewMode) {
      if (patient && globalNotes !== (patient.notes || "")) {
        try {
          await updatePatientNotes(patient.id, globalNotes);
        } catch (e) {
          console.error(e);
        }
      }
      onClose();
      return;
    }

    try {
      if (appointment) {
        let finalObjective = soapNotes.objetivo;
        if (vitalSigns.peso || vitalSigns.sys) {
          finalObjective = `[Signos Vitales - Peso: ${vitalSigns.peso || "-"}kg, TA: ${vitalSigns.sys || "-"}/${vitalSigns.dia || "-"}]\n${finalObjective}`;
        }

        await Promise.all([
          saveSoapNote(
            appointment.id,
            appointment.patientId,
            soapNotes.subjetivo,
            finalObjective,
            soapNotes.analisis,
            soapNotes.plan,
          ),
          savePrescription(
            appointment.id,
            appointment.patientId,
            localPrescriptions,
          ),
          updatePatientNotes(appointment.patientId, globalNotes),
        ]);

        if (onFinishConsultation) {
          onFinishConsultation(appointment.id);
        } else {
          onClose();
        }
      }
    } catch (err: unknown) {
      console.error(
        "Error guardando consulta:",
        err instanceof Error ? err.message : err,
      );
      alert("Hubo un error al guardar la consulta.");
      setIsSaving(false);
    }
  };

  const handleAddPrescription = () => {
    if (newMedication.nombre) {
      setLocalPrescriptions([...localPrescriptions, { ...newMedication }]);
      setNewMedication({ nombre: "", dosis: "", indicaciones: "" });
      setIsPrescriptionModalOpen(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map((file) => file.name);
      setLocalFiles([...localFiles, ...newFiles]);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="min-h-screen bg-slate-50 pb-10 flex flex-col"
    >
      {/* TOP BAR */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 sticky top-0 z-40 shadow-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {/* FIX: La flecha ahora dispara el guardado automático */}
          <button
            onClick={handleFinishClick}
            disabled={isSaving}
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
          <Button
            onClick={handleFinishClick}
            disabled={isSaving}
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

      {/* WORKSPACE GRID */}
      <div className="max-w-360 mx-auto px-4 sm:px-6 pt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 w-full">
        {/* COLUMNA IZQUIERDA */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-12 bg-brand-light/30"></div>
            <div className="w-16 h-16 bg-white border-4 border-white rounded-full mx-auto relative z-10 shadow-sm flex items-center justify-center text-brand-gray mt-1">
              <User className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-extrabold text-brand-dark mt-2 leading-tight">
              {targetName}
            </h3>
            <p className="text-xs font-medium text-brand-gray mt-0.5">
              {targetPhone}
            </p>
          </div>

          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-400"></div>
            <h4 className="text-[11px] font-black text-amber-800 uppercase tracking-widest flex items-center gap-1.5 mb-2">
              <StickyNote className="w-3.5 h-3.5" /> Recordatorios Internos
            </h4>
            <textarea
              value={globalNotes}
              onChange={(e) => setGlobalNotes(e.target.value)}
              placeholder="Anota detalles administrativos aquí..."
              className="w-full bg-amber-50/50 border-none text-sm font-medium text-amber-900 focus:outline-none focus:ring-0 min-h-30 max-h-100 overflow-y-auto resize-y placeholder:text-amber-700/50 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-300 hover:[&::-webkit-scrollbar-thumb]:bg-amber-400 [&::-webkit-scrollbar-thumb]:rounded-full transition-colors"
            />
          </div>

          {!isReviewMode && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
              <h4 className="text-[11px] font-black text-brand-gray uppercase tracking-widest flex items-center gap-1.5 mb-3">
                <Activity className="w-3.5 h-3.5 text-brand-primary" /> Signos
                Vitales
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <p className="text-[9px] font-bold text-brand-gray uppercase">
                    Peso (kg)
                  </p>
                  <input
                    type="text"
                    placeholder="--"
                    value={vitalSigns.peso}
                    onChange={(e) =>
                      setVitalSigns({
                        ...vitalSigns,
                        peso: e.target.value.replace(/[^\d.]/g, "").slice(0, 5),
                      })
                    }
                    className="w-full bg-transparent text-sm font-bold text-brand-dark focus:outline-none mt-0.5"
                  />
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <p className="text-[9px] font-bold text-brand-gray uppercase">
                    Presión
                  </p>
                  <div className="flex items-center gap-1 mt-0.5 text-sm font-bold text-brand-dark">
                    <input
                      type="text"
                      placeholder="120"
                      value={vitalSigns.sys}
                      onChange={(e) =>
                        setVitalSigns({
                          ...vitalSigns,
                          sys: e.target.value.replace(/\D/g, "").slice(0, 3),
                        })
                      }
                      className="w-7 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-brand-primary/30 rounded"
                    />
                    <span className="text-slate-400">/</span>
                    <input
                      type="text"
                      placeholder="80"
                      value={vitalSigns.dia}
                      onChange={(e) =>
                        setVitalSigns({
                          ...vitalSigns,
                          dia: e.target.value.replace(/\D/g, "").slice(0, 3),
                        })
                      }
                      className="w-7 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-brand-primary/30 rounded"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h4 className="text-[11px] font-black text-brand-gray uppercase tracking-widest flex items-center gap-1.5 mb-3">
              <Clock className="w-3.5 h-3.5 text-brand-primary" /> Historial de
              Visitas
            </h4>
            {isLoadingHistory ? (
              <p className="text-xs text-brand-gray italic text-center py-2">
                Cargando...
              </p>
            ) : history?.notes && history.notes.length > 0 ? (
              <div className="space-y-3">
                {history.notes.map((note, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      if (isReviewMode) {
                        setViewingHistoricalNote(note);
                        setActiveTab("notas");
                      }
                    }}
                    className={`flex items-start gap-2 relative group ${isReviewMode ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 relative z-10 transition-all ${viewingHistoricalNote?.id === note.id ? "bg-brand-primary scale-150" : "bg-slate-300 group-hover:bg-brand-primary"}`}
                    ></div>
                    {idx !== history.notes.length - 1 && (
                      <div className="absolute left-0.75 top-2.5 -bottom-3.75 w-px bg-slate-200"></div>
                    )}
                    <div>
                      <p
                        className={`text-xs font-bold transition-colors line-clamp-1 ${viewingHistoricalNote?.id === note.id ? "text-brand-primary" : "text-brand-dark group-hover:text-brand-primary"}`}
                      >
                        {note.analysis || "Visita de rutina"}
                      </p>
                      <p className="text-[10px] font-medium text-brand-gray">
                        {new Date(note.createdAt).toLocaleDateString("es-MX")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-brand-gray italic text-center py-2">
                No hay visitas previas.
              </p>
            )}
          </div>
        </div>

        {/* COLUMNA DERECHA (Espacio de Trabajo) */}
        <div className="lg:col-span-9 bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col h-[calc(100vh-120px)]">
          <div className="flex border-b border-slate-200 bg-slate-50/80 px-2 pt-2 overflow-x-auto hide-scrollbar shrink-0">
            {WORKSPACE_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${activeTab === tab.id ? "border-brand-primary text-brand-primary bg-white rounded-t-xl" : "border-transparent text-brand-gray hover:text-brand-dark hover:bg-slate-100 rounded-t-xl"}`}
                >
                  <Icon className="w-4 h-4 shrink-0" /> {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-6 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
            {activeTab === "notas" && (
              <div className="flex flex-col h-full gap-5">
                {isReviewMode ? (
                  viewingHistoricalNote ? (
                    <>
                      <div className="bg-brand-light/10 border border-brand-primary/20 rounded-xl p-4 mb-2 flex items-center justify-between">
                        <h3 className="font-bold text-brand-dark text-sm">
                          Mostrando expediente del:{" "}
                          {new Date(
                            viewingHistoricalNote.createdAt,
                          ).toLocaleDateString("es-MX", {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                        </h3>
                        <span className="text-[10px] font-bold bg-brand-light/30 text-brand-primary px-2 py-1 rounded uppercase tracking-wider">
                          Solo Lectura
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 min-h-62.5">
                        <div className="flex flex-col h-full">
                          <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                            S - Motivo y Síntomas
                          </label>
                          <textarea
                            readOnly
                            value={
                              viewingHistoricalNote.subjective || "Sin registro"
                            }
                            className="mt-2 flex-1 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                        <div className="flex flex-col h-full">
                          <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                            O - Exploración Física
                          </label>
                          <textarea
                            readOnly
                            value={
                              viewingHistoricalNote.objective || "Sin registro"
                            }
                            className="mt-2 flex-1 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 min-h-62.5">
                        <div className="flex flex-col h-full">
                          <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                            A - Diagnóstico (Análisis)
                          </label>
                          <textarea
                            readOnly
                            value={
                              viewingHistoricalNote.analysis || "Sin registro"
                            }
                            className="mt-2 flex-1 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                        <div className="flex flex-col h-full">
                          <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                            P - Tratamiento (Plan)
                          </label>
                          <textarea
                            readOnly
                            value={viewingHistoricalNote.plan || "Sin registro"}
                            className="mt-2 flex-1 w-full px-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-base text-slate-600 outline-none resize-none leading-relaxed"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200 my-auto">
                      <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <h3 className="text-lg font-bold text-brand-dark">
                        Modo de Solo Lectura
                      </h3>
                      <p className="text-sm text-brand-gray max-w-md mx-auto mt-2">
                        Haz clic en alguna de las fechas del{" "}
                        <strong className="text-brand-dark">
                          Historial de Visitas
                        </strong>{" "}
                        en el panel izquierdo para leer las notas clínicas de
                        ese día.
                      </p>
                    </div>
                  )
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 min-h-62.5">
                      <div className="flex flex-col h-full">
                        <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                          S - Motivo y Síntomas
                        </label>
                        <textarea
                          value={soapNotes.subjetivo}
                          onChange={(e) =>
                            setSoapNotes({
                              ...soapNotes,
                              subjetivo: e.target.value,
                            })
                          }
                          placeholder="¿Por qué viene el paciente?"
                          className="mt-2 flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                        />
                      </div>
                      <div className="flex flex-col h-full">
                        <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                          O - Exploración Física
                        </label>
                        <textarea
                          value={soapNotes.objetivo}
                          onChange={(e) =>
                            setSoapNotes({
                              ...soapNotes,
                              objetivo: e.target.value,
                            })
                          }
                          placeholder="¿Qué observas? (Peso y Presión se agregan solos)"
                          className="mt-2 flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 min-h-62.5">
                      <div className="flex flex-col h-full">
                        <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                          A - Diagnóstico (Análisis)
                        </label>
                        <textarea
                          value={soapNotes.analisis}
                          onChange={(e) =>
                            setSoapNotes({
                              ...soapNotes,
                              analisis: e.target.value,
                            })
                          }
                          placeholder="Impresión diagnóstica..."
                          className="mt-2 flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
                        />
                      </div>
                      <div className="flex flex-col h-full">
                        <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                          P - Tratamiento (Plan)
                        </label>
                        <textarea
                          value={soapNotes.plan}
                          onChange={(e) =>
                            setSoapNotes({ ...soapNotes, plan: e.target.value })
                          }
                          placeholder="Procedimiento o plan a seguir..."
                          className="mt-2 flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:bg-white focus:border-brand-primary outline-none resize-none transition-all leading-relaxed"
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
                    <h3 className="text-base font-bold text-brand-dark">
                      Registro de Recetas
                    </h3>
                    <p className="text-xs text-brand-gray mt-0.5">
                      Medicamentos indicados al paciente.
                    </p>
                  </div>
                  {!isReviewMode && (
                    <Button
                      onClick={() => setIsPrescriptionModalOpen(true)}
                      className="w-full sm:w-auto px-4 py-2.5 text-sm rounded-lg cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Nueva Indicación
                    </Button>
                  )}
                </div>

                {localPrescriptions.length > 0 ||
                (history?.prescriptions && history.prescriptions.length > 0) ? (
                  <div className="space-y-3">
                    {localPrescriptions.map((med, idx) => (
                      <div
                        key={`local-${idx}`}
                        className="bg-brand-light/10 border border-brand-primary/30 p-4 rounded-xl flex items-start justify-between"
                      >
                        <div>
                          <p className="text-sm font-bold text-brand-dark">
                            {med.nombre}{" "}
                            <span className="text-brand-primary font-medium">
                              ({med.dosis})
                            </span>
                          </p>
                          <p className="text-sm text-brand-gray mt-1">
                            {med.indicaciones}
                          </p>
                          <span className="text-[10px] font-bold text-brand-primary mt-2 block">
                            Emitida: HOY
                          </span>
                        </div>
                      </div>
                    ))}
                    {history?.prescriptions.map((pres) =>
                      pres.medications.map((med, mIdx) => (
                        <div
                          key={`hist-${pres.id}-${mIdx}`}
                          className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-start justify-between group hover:border-brand-primary/50 transition-colors cursor-pointer"
                        >
                          <div className="flex-1 pr-4">
                            <p className="text-sm font-bold text-brand-dark">
                              {med.nombre}{" "}
                              <span className="text-brand-gray font-medium">
                                ({med.dosis})
                              </span>
                            </p>
                            <p className="text-xs text-brand-gray mt-1 line-clamp-1">
                              {med.indicaciones}
                            </p>
                            <span className="text-[10px] font-bold text-slate-400 mt-2 block">
                              Emitida:{" "}
                              {new Date(pres.createdAt).toLocaleDateString(
                                "es-MX",
                              )}
                            </span>
                          </div>
                          {!isReviewMode && (
                            <button className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold py-1.5 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm">
                              <Copy className="w-3 h-3" /> Copiar
                            </button>
                          )}
                        </div>
                      )),
                    )}
                  </div>
                ) : (
                  <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <Pill className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-medium text-brand-gray">
                      No hay recetas previas en el historial.
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "fotos" && (
              <div className="space-y-8">
                {!isReviewMode && (
                  <label className="border-2 border-dashed border-brand-primary/30 rounded-2xl p-8 flex flex-col items-center justify-center bg-brand-light/5 hover:bg-brand-light/10 transition-colors cursor-pointer group">
                    <input
                      type="file"
                      multiple
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-brand-primary shadow-sm mb-3 group-hover:scale-110 transition-transform">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-bold text-brand-dark">
                      Sube fotos o estudios a esta consulta
                    </p>
                    <p className="text-xs text-brand-gray mt-1">
                      Soporta JPG, PNG, PDF (Max 10MB)
                    </p>
                  </label>
                )}
                <div className="space-y-6">
                  {localFiles.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-bold text-brand-gray uppercase tracking-widest mb-3 pb-2 border-b border-slate-100">
                        Hoy
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {localFiles.map((filename, i) => (
                          <div
                            key={i}
                            className="aspect-square bg-slate-100 rounded-xl border border-slate-200 flex flex-col items-center justify-center p-2 text-center"
                          >
                            <FileDown className="w-8 h-8 text-brand-primary mb-2" />
                            <span className="text-xs font-bold text-slate-600 truncate w-full">
                              {filename}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <h4 className="text-[11px] font-bold text-brand-gray uppercase tracking-widest mb-3 pb-2 border-b border-slate-100 flex items-center gap-2">
                      Historial Visual
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {MOCK_PATIENT_PHOTOS.map((photo, index) => (
                        <div
                          key={index}
                          onClick={() => setPhotoViewerIndex(index)}
                          className="aspect-square bg-slate-100 rounded-xl border border-slate-200 overflow-hidden relative group cursor-pointer flex flex-col items-center justify-center"
                        >
                          <Camera className="w-8 h-8 text-slate-300" />
                          <div className="absolute inset-0 bg-brand-dark/0 group-hover:bg-brand-dark/20 transition-colors flex items-center justify-center">
                            <Search className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <span className="absolute bottom-2 left-2 text-[10px] font-bold text-white bg-black/50 px-1.5 rounded truncate max-w-[90%]">
                            {photo}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODALES */}
      <Modal
        isOpen={isPrescriptionModalOpen}
        onClose={() => setIsPrescriptionModalOpen(false)}
        title="Nueva Indicación Médica"
        icon={<Pill className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        <div className="space-y-4 pb-2">
          <div>
            <label className="text-brand-dark font-bold text-sm mb-1 block">
              Nombre del Medicamento
            </label>
            <input
              type="text"
              value={newMedication.nombre}
              onChange={(e) =>
                setNewMedication({ ...newMedication, nombre: e.target.value })
              }
              placeholder="Ej. Ibuprofeno..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-brand-primary outline-none"
            />
          </div>
          <div>
            <label className="text-brand-dark font-bold text-sm mb-1 block">
              Dosis y Presentación
            </label>
            <input
              type="text"
              value={newMedication.dosis}
              onChange={(e) =>
                setNewMedication({ ...newMedication, dosis: e.target.value })
              }
              placeholder="Ej. 400mg, 1 Tableta..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-brand-primary outline-none"
            />
          </div>
          <div>
            <label className="text-brand-dark font-bold text-sm mb-1 block">
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
              placeholder="Ej. Tomar 1 tableta cada 8 horas..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-brand-primary outline-none resize-none h-24"
            />
          </div>
          <div className="pt-4 border-t border-slate-100 flex gap-3 mt-4">
            <Button
              variant="outline"
              onClick={() => setIsPrescriptionModalOpen(false)}
              className="flex-1 py-3 rounded-xl cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAddPrescription}
              disabled={!newMedication.nombre}
              className="flex-1 py-3 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md disabled:opacity-50 cursor-pointer"
            >
              Añadir a la Receta
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={photoViewerIndex !== null}
        onClose={() => setPhotoViewerIndex(null)}
        title="Visor de Imagen"
        hideFooter={true}
      >
        {photoViewerIndex !== null && (
          <div className="flex flex-col items-center justify-center bg-slate-900 rounded-2xl min-h-100 border border-slate-800 relative overflow-hidden p-8 -mt-2 -mx-2 -mb-4">
            <button
              onClick={() =>
                setPhotoViewerIndex(
                  (photoViewerIndex - 1 + MOCK_PATIENT_PHOTOS.length) %
                    MOCK_PATIENT_PHOTOS.length,
                )
              }
              className="absolute left-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <Camera className="w-20 h-20 text-slate-700 mb-4" />
            <p className="text-lg font-bold text-slate-300 text-center">
              Foto de Expediente
              <br />
              {photoViewerIndex + 1} de {MOCK_PATIENT_PHOTOS.length}
            </p>
            <p className="text-sm text-slate-500 mt-2 bg-black/40 px-3 py-1 rounded-md">
              {MOCK_PATIENT_PHOTOS[photoViewerIndex]}
            </p>
            <button
              onClick={() =>
                setPhotoViewerIndex(
                  (photoViewerIndex + 1) % MOCK_PATIENT_PHOTOS.length,
                )
              }
              className="absolute right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-colors cursor-pointer"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};
