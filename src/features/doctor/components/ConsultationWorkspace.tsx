import { useState, useEffect, useRef } from "react";
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
import {
  uploadPatientFile,
  getPatientFiles,
  type ClinicalFile,
} from "../../../lib/services/storageService";

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

  const [patientFiles, setPatientFiles] = useState<ClinicalFile[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);

  const [isSaving, setIsSaving] = useState(false);

  //ESTADO PARA EL ZOOM
  const [zoomLevel, setZoomLevel] = useState(100);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const loadWorkspaceData = async () => {
      if (!targetId) return;
      setIsLoadingHistory(true);
      try {
        const [historyData, filesData] = await Promise.all([
          fetchPatientHistory(targetId),
          getPatientFiles(targetId),
        ]);
        setHistory(historyData);
        setPatientFiles(filesData);

        // AUTO-SELECCIONAR LA ÚLTIMA CITA EN MODO REVISIÓN
        if (isReviewMode && historyData.notes.length > 0) {
          setViewingHistoricalNote(historyData.notes[0]);
        }
      } catch (err: unknown) {
        console.error("Error cargando datos del workspace:", err);
        toast.error("Error al cargar el expediente.");
      } finally {
        setIsLoadingHistory(false);
      }
    };
    loadWorkspaceData();
  }, [targetId, isReviewMode]);

  const handleFinishClick = async () => {
    setIsSaving(true);
    if (isReviewMode) {
      if (patient && globalNotes !== (patient.notes || "")) {
        try {
          await updatePatientNotes(patient.id, globalNotes);
          toast.success("Recordatorios actualizados.");
        } catch (e) {
          console.error(e);
          toast.error("Error al guardar recordatorios.");
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
      console.error("Error guardando consulta:", err);
      toast.error("Hubo un error al guardar la consulta.");
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setIsUploadingFile(true);
    const loadingToast = toast.loading("Subiendo archivos...");

    try {
      const uploadPromises = Array.from(e.target.files).map((file) =>
        uploadPatientFile(targetId, file),
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
      <div className="bg-white border-b border-slate-200 px-6 py-3 sticky top-0 z-40 shadow-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
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
              {targetPhone}
            </p>
          </div>

          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-400"></div>
            <h4 className="text-xs font-black text-amber-800 uppercase tracking-widest flex items-center gap-1.5 mb-2">
              <StickyNote className="w-4 h-4" /> Recordatorios Internos
            </h4>
            <textarea
              value={globalNotes}
              onChange={(e) => setGlobalNotes(e.target.value)}
              placeholder="Anota detalles administrativos aquí..."
              className="w-full bg-amber-50/50 border-none text-base font-medium text-amber-900 focus:outline-none focus:ring-0 min-h-30 max-h-100 overflow-y-auto resize-y placeholder:text-amber-700/50 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-300 hover:[&::-webkit-scrollbar-thumb]:bg-amber-400 [&::-webkit-scrollbar-thumb]:rounded-full transition-colors"
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
                    className="w-full bg-transparent text-base font-bold text-brand-dark focus:outline-none mt-0.5"
                  />
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <p className="text-[10px] font-bold text-brand-gray uppercase">
                    Presión
                  </p>
                  <div className="flex items-center gap-1 mt-0.5 text-base font-bold text-brand-dark">
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
                      className="w-8 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-brand-primary/30 rounded"
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
                      className="w-8 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-brand-primary/30 rounded"
                    />
                  </div>
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
            ) : history?.notes && history.notes.length > 0 ? (
              <div className="space-y-4 mt-2">
                {history.notes.map((note, idx) => (
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
                    {idx !== history.notes.length - 1 && (
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
                        <h3 className="font-bold text-brand-dark text-base">
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
                        <span className="text-xs font-bold bg-brand-light/30 text-brand-primary px-3 py-1.5 rounded uppercase tracking-wider">
                          Solo Lectura
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 min-h-62.5">
                        <div className="flex flex-col h-full">
                          <label className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
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
                          <label className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
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
                          <label className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
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
                          <label className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 min-h-62.5">
                      <div className="flex flex-col h-full">
                        <label className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
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
                        <label className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
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
                        <label className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
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
                        <label className="text-brand-dark font-bold text-sm uppercase tracking-wider block">
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
                    <h3 className="text-lg font-bold text-brand-dark">
                      Registro de Recetas
                    </h3>
                    <p className="text-sm text-brand-gray mt-0.5">
                      Medicamentos indicados al paciente.
                    </p>
                  </div>
                  {!isReviewMode && (
                    <Button
                      onClick={() => setIsPrescriptionModalOpen(true)}
                      className="w-full sm:w-auto px-5 py-3 text-sm rounded-lg cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2"
                    >
                      <Plus className="w-5 h-5" /> Nueva Indicación
                    </Button>
                  )}
                </div>

                {localPrescriptions.length > 0 ||
                (history?.prescriptions && history.prescriptions.length > 0) ? (
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
                    {history?.prescriptions.map((pres) =>
                      pres.medications.map((med, mIdx) => (
                        <div
                          key={`hist-${pres.id}-${mIdx}`}
                          className="bg-slate-50 border border-slate-200 p-5 rounded-xl flex items-start justify-between group transition-colors"
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
                            <span className="text-xs font-bold text-slate-400 mt-2 block">
                              Emitida:{" "}
                              {new Date(pres.createdAt).toLocaleDateString(
                                "es-MX",
                              )}
                            </span>
                          </div>
                          {!isReviewMode && (
                            <button className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold py-2 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm">
                              <Copy className="w-4 h-4" /> Copiar
                            </button>
                          )}
                        </div>
                      )),
                    )}
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

            {activeTab === "fotos" && (
              <div className="space-y-8">
                <label
                  className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-colors cursor-pointer group ${isUploadingFile ? "border-slate-300 bg-slate-50 pointer-events-none opacity-60" : "border-brand-primary/30 bg-brand-light/5 hover:bg-brand-light/10"}`}
                >
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf"
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
                    Soporta JPG, PNG, PDF
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
              placeholder="Ej. Tomar 1 tableta cada 8 horas..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base focus:border-brand-primary outline-none resize-none h-32"
            />
          </div>
          <div className="pt-4 border-t border-slate-100 flex gap-3 mt-4">
            <Button
              variant="outline"
              onClick={() => setIsPrescriptionModalOpen(false)}
              className="flex-1 py-4 rounded-xl cursor-pointer text-base"
            >
              Cancelar
            </Button>
            <Button
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
              <button
                onClick={() => setZoomLevel((prev) => Math.max(50, prev - 25))}
                className="p-2 hover:bg-slate-100 text-brand-dark rounded-lg transition-colors cursor-pointer"
                title="Alejar"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <button
                onClick={() => setZoomLevel(100)}
                className="px-3 hover:bg-slate-100 text-brand-dark font-bold text-xs rounded-lg transition-colors cursor-pointer w-14 text-center"
                title="Restaurar tamaño"
              >
                {zoomLevel}%
              </button>
              <button
                onClick={() => setZoomLevel((prev) => Math.min(300, prev + 25))}
                className="p-2 hover:bg-slate-100 text-brand-dark rounded-lg transition-colors cursor-pointer"
                title="Acercar"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
            </div>

            {/* BOTÓN ANTERIOR */}
            <button
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
            <button
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
