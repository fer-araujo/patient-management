import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  User,
  Activity,
  Clock,
  FileText,
  Camera,
  Pill,
  FileDown,
  UploadCloud,
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { type AppointmentData } from "../../../data/mockPatients";

interface ConsultationWorkspaceProps {
  appointment: AppointmentData;
  onClose: () => void;
  onFinishConsultation: (id: string) => void;
}

type WorkspaceTab = "notas" | "receta" | "fotos";

interface LocalPrescription {
  nombre: string;
  dosis: string;
  indicaciones: string;
  date: string;
}

const WORKSPACE_TABS: {
  id: WorkspaceTab;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "notas", label: "Notas Clínicas (SOAP)", icon: FileText },
  { id: "receta", label: "Recetas e Indicaciones", icon: Pill },
  { id: "fotos", label: "Galería y Estudios", icon: Camera },
];

// FOTOS SIMULADAS PARA EL CARRUSEL
const MOCK_PATIENT_PHOTOS = [
  "Rostro_Frente.jpg",
  "Rostro_Perfil_Derecho.jpg",
  "Rostro_Perfil_Izquierdo.jpg",
];

export const ConsultationWorkspace = ({
  appointment,
  onClose,
  onFinishConsultation,
}: ConsultationWorkspaceProps) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("notas");

  // ESTADOS DE FORMULARIOS
  const [soapNotes, setSoapNotes] = useState({
    subjetivo: appointment.isNewPatient ? "" : "Acude a revisión. Refiere...",
    objetivo: "",
    analisis: "",
    plan: "",
  });

  // FIX: Signos vitales separados para la presión
  const [vitalSigns, setVitalSigns] = useState({ peso: "", sys: "", dia: "" });

  // ESTADOS PARA RECETAS
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [newMedication, setNewMedication] = useState({
    nombre: "",
    dosis: "",
    indicaciones: "",
  });
  const [localPrescriptions, setLocalPrescriptions] = useState<
    LocalPrescription[]
  >([]);

  // ESTADOS PARA GALERÍA
  const [localFiles, setLocalFiles] = useState<string[]>([]);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);

  // ESTADO PARA ANIMACIÓN
  const [isFinishing, setIsFinishing] = useState(false);

  const handleFinishClick = () => {
    setIsFinishing(true);
    setTimeout(() => {
      onFinishConsultation(appointment.id);
    }, 1500);
  };

  const handleAddPrescription = () => {
    if (newMedication.nombre) {
      setLocalPrescriptions([
        ...localPrescriptions,
        { ...newMedication, date: "Hoy" },
      ]);
      setNewMedication({ nombre: "", dosis: "", indicaciones: "" });
      setIsPrescriptionModalOpen(false);
    }
  };

  // FIX: Manejador de subida de archivos simulada
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map((file) => file.name);
      setLocalFiles([...localFiles, ...newFiles]);
    }
  };

  if (isFinishing) {
    return (
      <div className="fixed inset-0 z-50 bg-teal-500 flex flex-col items-center justify-center text-white">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex flex-col items-center"
        >
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-2xl">
            <CheckCircle2 className="w-12 h-12 text-teal-500" />
          </div>
          <h2 className="text-4xl font-black mb-2">Consulta Finalizada</h2>
          <p className="text-teal-100 font-medium text-lg">
            Guardando expediente clínico de {appointment.patientName}...
          </p>
        </motion.div>
      </div>
    );
  }

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
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 text-brand-gray transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="animate-pulse w-2 h-2 bg-rose-500 rounded-full"></span>
              <h2 className="text-base font-bold text-brand-dark leading-none truncate max-w-[200px] sm:max-w-xs">
                Consulta Activa
              </h2>
            </div>
            <p className="text-xs font-medium text-brand-gray mt-1 truncate">
              {appointment.time} • {appointment.service}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl border-slate-200 text-brand-gray hover:bg-slate-50 hover:text-brand-dark cursor-pointer font-bold whitespace-nowrap"
          >
            <Save className="w-4 h-4 shrink-0" /> Guardar Borrador
          </Button>
          <Button
            onClick={handleFinishClick}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white cursor-pointer font-bold border-none shadow-sm text-sm whitespace-nowrap"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" /> Finalizar Consulta
          </Button>
        </div>
      </div>

      {/* WORKSPACE GRID */}
      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 pt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* COLUMNA IZQUIERDA */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-12 bg-brand-light/30"></div>
            <div className="w-16 h-16 bg-white border-4 border-white rounded-full mx-auto relative z-10 shadow-sm flex items-center justify-center text-brand-gray mt-1">
              <User className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-extrabold text-brand-dark mt-2 leading-tight">
              {appointment.patientName}
            </h3>
            <p className="text-xs font-medium text-brand-gray mt-0.5">
              {appointment.phone}
            </p>
            <div className="mt-3 pt-3 border-t border-slate-100">
              {appointment.isNewPatient ? (
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded uppercase tracking-wider">
                  Primera Vez
                </span>
              ) : (
                <span className="text-[10px] font-bold text-brand-primary bg-brand-light/30 px-2 py-1 rounded uppercase tracking-wider">
                  Paciente Recurrente
                </span>
              )}
            </div>
          </div>

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
                {/* FIX: Lógica de peso a máximo 5 caracteres numéricos */}
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
                {/* FIX: Presión con UX moderna (Dos inputs separados) */}
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
                    className="w-7 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-300 rounded"
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
                    className="w-7 bg-transparent text-center focus:outline-none focus:bg-white focus:ring-1 focus:ring-slate-300 rounded"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* FIX: El historial siempre existe, solo cambia el contenido si es nuevo */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h4 className="text-[11px] font-black text-brand-gray uppercase tracking-widest flex items-center gap-1.5 mb-3">
              <Clock className="w-3.5 h-3.5 text-brand-primary" /> Últimas
              Visitas
            </h4>
            {appointment.isNewPatient ? (
              <p className="text-xs text-brand-gray italic text-center py-2">
                No hay visitas registradas anteriormente.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-2 relative cursor-pointer group">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-primary mt-1.5 shrink-0 relative z-10 group-hover:scale-150 transition-transform"></div>
                  <div className="absolute left-[3px] top-2.5 bottom-[-15px] w-[1px] bg-slate-200"></div>
                  <div>
                    <p className="text-xs font-bold text-brand-dark group-hover:text-brand-primary transition-colors">
                      Toxina Botulínica
                    </p>
                    <p className="text-[10px] font-medium text-brand-gray">
                      12 Nov 2025
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 relative cursor-pointer group">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0 relative z-10 group-hover:scale-150 group-hover:bg-brand-primary transition-all"></div>
                  <div>
                    <p className="text-xs font-bold text-brand-dark group-hover:text-brand-primary transition-colors">
                      Valoración Inicial
                    </p>
                    <p className="text-[10px] font-medium text-brand-gray">
                      05 Sep 2025
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* COLUMNA DERECHA */}
        <div className="lg:col-span-9 bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col h-[calc(100vh-120px)]">
          <div className="flex border-b border-slate-200 bg-slate-50/80 px-2 pt-2 overflow-x-auto hide-scrollbar shrink-0">
            {WORKSPACE_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === tab.id
                      ? "border-brand-primary text-brand-primary bg-white rounded-t-xl"
                      : "border-transparent text-brand-gray hover:text-brand-dark hover:bg-slate-100 rounded-t-xl"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" /> {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-6 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
            {activeTab === "notas" && (
              <div className="flex flex-col h-full gap-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 min-h-[200px]">
                  <div className="flex flex-col h-full">
                    <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                      S - Subjetivo
                    </label>
                    <p className="text-[10px] text-brand-gray mb-2">
                      Motivo de consulta y síntomas.
                    </p>
                    <textarea
                      value={soapNotes.subjetivo}
                      onChange={(e) =>
                        setSoapNotes({
                          ...soapNotes,
                          subjetivo: e.target.value,
                        })
                      }
                      placeholder="Escribe aquí..."
                      className="flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-brand-primary outline-none resize-none transition-all"
                    />
                  </div>
                  <div className="flex flex-col h-full">
                    <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                      O - Objetivo
                    </label>
                    <p className="text-[10px] text-brand-gray mb-2">
                      Exploración física clínica.
                    </p>
                    <textarea
                      value={soapNotes.objetivo}
                      onChange={(e) =>
                        setSoapNotes({ ...soapNotes, objetivo: e.target.value })
                      }
                      placeholder="Escribe aquí..."
                      className="flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-brand-primary outline-none resize-none transition-all"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 min-h-[200px]">
                  <div className="flex flex-col h-full">
                    <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                      A - Análisis
                    </label>
                    <p className="text-[10px] text-brand-gray mb-2">
                      Diagnóstico y evaluación médica.
                    </p>
                    <textarea
                      value={soapNotes.analisis}
                      onChange={(e) =>
                        setSoapNotes({ ...soapNotes, analisis: e.target.value })
                      }
                      placeholder="Escribe aquí..."
                      className="flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-brand-primary outline-none resize-none transition-all"
                    />
                  </div>
                  <div className="flex flex-col h-full">
                    <label className="text-brand-dark font-bold text-xs uppercase tracking-wider block">
                      P - Plan
                    </label>
                    <p className="text-[10px] text-brand-gray mb-2">
                      Tratamiento a seguir.
                    </p>
                    <textarea
                      value={soapNotes.plan}
                      onChange={(e) =>
                        setSoapNotes({ ...soapNotes, plan: e.target.value })
                      }
                      placeholder="Ej: Aplicación de 20U Toxina en frontal..."
                      className="flex-1 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:border-brand-primary outline-none resize-none transition-all"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "receta" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-brand-dark">
                      Registro de Recetas e Indicaciones
                    </h3>
                    <p className="text-xs text-brand-gray mt-0.5">
                      Mantén un registro interno físico de los medicamentos
                      indicados al paciente.
                    </p>
                  </div>
                  <Button
                    onClick={() => setIsPrescriptionModalOpen(true)}
                    className="w-full sm:w-auto px-4 py-2.5 text-sm rounded-lg cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Nueva Indicación
                  </Button>
                </div>

                {localPrescriptions.length > 0 || !appointment.isNewPatient ? (
                  <div className="space-y-3">
                    <h4 className="text-[11px] font-bold text-brand-gray uppercase tracking-widest">
                      Historial de Recetas
                    </h4>

                    {localPrescriptions.map((med, idx) => (
                      <div
                        key={idx}
                        className="bg-brand-light/10 border border-brand-primary/30 p-4 rounded-xl flex items-start justify-between"
                      >
                        <div>
                          <p className="text-sm font-bold text-brand-dark">
                            {med.nombre}{" "}
                            <span className="text-brand-primary font-medium">
                              ({med.dosis})
                            </span>
                          </p>
                          <p className="text-xs text-brand-gray mt-1">
                            {med.indicaciones}
                          </p>
                          <span className="text-[10px] font-bold text-brand-primary mt-2 block">
                            Emitida: {med.date} (Reciente)
                          </span>
                        </div>
                      </div>
                    ))}

                    {!appointment.isNewPatient && (
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-start justify-between group hover:border-brand-primary/50 transition-colors cursor-pointer">
                        <div>
                          <p className="text-sm font-bold text-brand-dark">
                            Cataflam 50mg, Mefinal 500mg
                          </p>
                          <p className="text-xs text-brand-gray mt-1 line-clamp-1">
                            "Tomar 1 cada 8 horas por 3 días en caso de
                            dolor..."
                          </p>
                          <span className="text-[10px] font-bold text-slate-400 mt-2 block">
                            Emitida: 12 Nov 2025
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs py-1.5 px-3"
                        >
                          Copiar
                        </Button>
                      </div>
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
                {/* FIX: Input File real conectado */}
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
                    Sube fotos o estudios médicos a este expediente
                  </p>
                  <p className="text-xs text-brand-gray mt-1">
                    Soporta JPG, PNG, PDF (Max 10MB) - Haz clic para explorar
                  </p>
                </label>

                <div className="space-y-6">
                  {/* Archivos subidos hoy */}
                  <div>
                    <h4 className="text-[11px] font-bold text-brand-gray uppercase tracking-widest mb-3 pb-2 border-b border-slate-100">
                      Hoy • {new Date().toLocaleDateString("es-MX")}
                    </h4>
                    {localFiles.length === 0 ? (
                      <p className="text-xs text-brand-gray italic">
                        Aún no hay archivos subidos hoy.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {localFiles.map((filename, i) => (
                          <div
                            key={i}
                            className="aspect-square bg-slate-100 rounded-xl border border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:border-brand-primary transition-colors p-2 text-center"
                          >
                            <FileDown className="w-8 h-8 text-brand-primary mb-2" />
                            <span className="text-xs font-bold text-slate-600 truncate w-full">
                              {filename}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Historial anterior */}
                  {!appointment.isNewPatient && (
                    <div>
                      <h4 className="text-[11px] font-bold text-brand-gray uppercase tracking-widest mb-3 pb-2 border-b border-slate-100 flex items-center gap-2">
                        10 Mar 2026{" "}
                        <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[9px]">
                          Subido por Paciente
                        </span>
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="aspect-square bg-slate-100 rounded-xl border border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:border-brand-primary transition-colors">
                          <FileDown className="w-8 h-8 text-rose-500 mb-2" />
                          <span className="text-xs font-bold text-slate-600 truncate px-2">
                            Sangre.pdf
                          </span>
                        </div>

                        {/* Render del array simulado para carrusel */}
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
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE AGREGAR RECETA */}
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
              placeholder="Ej. Ibuprofeno, Cataflam..."
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
              placeholder="Ej. Tomar 1 tableta cada 8 horas por 5 días."
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
              Guardar en Historial
            </Button>
          </div>
        </div>
      </Modal>

      {/* FIX: MODAL DE VISOR DE FOTOS CON CARRUSEL */}
      <Modal
        isOpen={photoViewerIndex !== null}
        onClose={() => setPhotoViewerIndex(null)}
        title="Visor de Imagen"
        hideFooter={true}
      >
        {photoViewerIndex !== null && (
          <div className="flex flex-col items-center justify-center bg-slate-900 rounded-2xl min-h-[400px] border border-slate-800 relative overflow-hidden p-8 -mt-2 -mx-2 -mb-4">
            {/* Flecha Izquierda */}
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

            {/* Contenido (Foto Simulada) */}
            <Camera className="w-20 h-20 text-slate-700 mb-4" />
            <p className="text-lg font-bold text-slate-300 text-center">
              Foto de Expediente
              <br />
              {photoViewerIndex + 1} de {MOCK_PATIENT_PHOTOS.length}
            </p>
            <p className="text-sm text-slate-500 mt-2 bg-black/40 px-3 py-1 rounded-md">
              {MOCK_PATIENT_PHOTOS[photoViewerIndex]}
            </p>

            {/* Flecha Derecha */}
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
