import { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Trash2,
  Loader2,
  Leaf,
  FileText,
} from "lucide-react";
import toast from "react-hot-toast";

import { NextAppointmentCard } from "./widgets/NextAppoinmentCard";
import { PastAppointmentsList } from "./widgets/PastAppoinmentsList";
import { QuickActionsWidget } from "./widgets/QuickActionsWidget";
import { ExploreTreatmentsWidget } from "./widgets/ExploreTratmentsWidget";
import { CarePlanWidget } from "./widgets/CarePlanWidget";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";

import {
  fetchMyProfile,
  fetchMyAppointments,
  fetchMyCarePlan,
  type PatientProfile,
  type PatientAppointment,
  type CarePlanItem,
} from "../../../lib/services/patientDashboardService";
import { cancelMyAppointment } from "../../../lib/services/patientBookingService";
import {
  uploadPatientFile,
  getPatientFiles,
} from "../../../lib/services/storageService";
import { fetchActiveServices } from "../../../lib/services/catalogService";
import { validateClinicalFile } from "../../../lib/files/clinicalUploadRules";
import { PrescriptionDisclaimer } from "../../../components/legal/PrescriptionDisclaimer";

export const PatientDashboard = () => {
  const navigate = useNavigate();

  const [profile, setProfile] = useState<
    (PatientProfile & { fileCount: number }) | null
  >(null);
  const [appointments, setAppointments] = useState<PatientAppointment[]>([]);
  const [carePlan, setCarePlan] = useState<CarePlanItem[]>([]);

  // ELIMINADO EL ESTADO CATALOG. YA NO LO NECESITAMOS.

  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  // Modales
  const [cancelState, setCancelState] = useState<
    "closed" | "confirm" | "success"
  >("closed");
  const [appointmentToCancel, setAppointmentToCancel] =
    useState<PatientAppointment | null>(null);
  const [isCareGuideOpen, setIsCareGuideOpen] = useState(false);
  const [careGuideText, setCareGuideText] = useState("Cargando guía...");
  const [isRecipeOpen, setIsRecipeOpen] = useState(false);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setIsLoading(true);
        const userProfile = await fetchMyProfile();
        setProfile(userProfile);

        // Ya no cargamos el catálogo aquí, aliviamos la carga inicial
        const [userAppointments, userCarePlan] = await Promise.all([
          fetchMyAppointments(userProfile.id),
          fetchMyCarePlan(userProfile.id),
        ]);

        setAppointments(userAppointments);
        setCarePlan(userCarePlan);
      } catch (error: unknown) {
        console.error(
          "[PatientDashboard] Error al cargar expediente completo:",
          error,
        );
        toast.error("Tu sesión ha expirado o hubo un error de conexión.");
        navigate("/");
      } finally {
        setIsLoading(false);
      }
    };
    loadDashboardData();
  }, [navigate]);

  const { futureAppointments, pastAppointments } = useMemo(() => {
    const now = new Date().getTime();
    const activeAppointments = appointments.filter(
      (a) => a.status !== "cancelled" && a.status !== "rejected",
    );
    return {
      futureAppointments: activeAppointments.filter((a) => a.timestamp >= now),
      pastAppointments: activeAppointments
        .filter((a) => a.timestamp < now)
        .sort((a, b) => b.timestamp - a.timestamp),
    };
  }, [appointments]);

  const primaryReferenceAppointment =
    futureAppointments[0] || pastAppointments[0] || null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    const invalidMessage = validateClinicalFile(file);
    if (invalidMessage) {
      toast.error(invalidMessage, { duration: 8000 });
      e.target.value = "";
      return;
    }

    setIsUploading(true);
    const loadingToast = toast.loading(`Subiendo ${file.name}...`);

    try {
      await uploadPatientFile(profile.id, file, "patient");
      const updatedFiles = await getPatientFiles(profile.id);

      setProfile((prev) =>
        prev ? { ...prev, fileCount: updatedFiles.length } : null,
      );
      toast.success("Estudios subidos correctamente.", { id: loadingToast });
    } catch (error: unknown) {
      console.error(
        "[PatientDashboard] Error crítico al subir archivo a Storage:",
        error,
      );
      toast.error("No se pudo subir el archivo. Inténtalo de nuevo.", {
        id: loadingToast,
      });
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleOpenCareGuide = async () => {
    setIsCareGuideOpen(true);
    setCareGuideText("Buscando las instrucciones de tu tratamiento...");

    if (!primaryReferenceAppointment) {
      setCareGuideText(
        "Aún no tienes tratamientos registrados. ¡Explora el catálogo!",
      );
      return;
    }

    try {
      // Como esto se abre rara vez, traemos el catálogo solo cuando el usuario da clic
      const catalog = await fetchActiveServices();
      const service = catalog.find(
        (s) => s.name === primaryReferenceAppointment.serviceName,
      );

      if (service && service.careGuide) {
        setCareGuideText(service.careGuide);
      } else {
        setCareGuideText(
          "No hay cuidados especiales registrados para este tratamiento. Si tienes dudas, contáctanos.",
        );
      }
    } catch (error: unknown) {
      console.error(
        "[PatientDashboard] Error al extraer la guía de cuidados del catálogo:",
        error,
      );
      setCareGuideText("No se pudo cargar la guía en este momento.");
    }
  };

  const handleStartCancel = (apt: PatientAppointment) => {
    setAppointmentToCancel(apt);
    setCancelState("confirm");
  };

  const handleConfirmCancel = async () => {
    if (!appointmentToCancel) return;
    try {
      await cancelMyAppointment(appointmentToCancel.id, "Cancelada por paciente");
      setCancelState("success");
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === appointmentToCancel.id ? { ...a, status: "cancelled" } : a,
        ),
      );
      setTimeout(() => {
        setCancelState("closed");
        setAppointmentToCancel(null);
      }, 2000);
    } catch (error: unknown) {
      console.error(
        `[PatientDashboard] Error al cancelar la cita ID ${appointmentToCancel.id}:`,
        error,
      );
      toast.error((error as Error).message || "No se pudo cancelar la cita.");
      setCancelState("closed");
    }
  };

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  };

  if (isLoading || !profile) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-brand-primary mb-4" />
        <p className="text-brand-gray font-bold">Cargando tu expediente...</p>
      </div>
    );
  }

  const fullName = `${profile.firstName} ${profile.lastName}`.trim();

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 xl:pt-10 pb-12">
      {isUploading && (
        <div className="fixed inset-0 z-100 bg-white/50 backdrop-blur-[2px] flex items-center justify-center cursor-not-allowed">
          <div className="bg-white p-4 rounded-full shadow-xl">
            <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
          </div>
        </div>
      )}

      {/* The greeting sits above the grid so both columns start on the same
          line, whatever the greeting's height. */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl xl:text-4xl font-extrabold text-brand-dark tracking-tight mb-1">
          Hola, {profile.firstName}.
        </h1>
        <p className="text-lg text-brand-gray font-medium">
          {futureAppointments.length > 0 ? (
            <>
              Tienes{" "}
              <span className="text-brand-primary font-bold">
                {futureAppointments.length}{" "}
                {futureAppointments.length === 1 ? "cita" : "citas"}
              </span>{" "}
              próxima{futureAppointments.length === 1 ? "" : "s"}.
            </>
          ) : (
            "No tienes citas próximas agendadas."
          )}
        </p>
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10"
      >
        {/* COLUMNA IZQUIERDA */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <motion.div variants={item}>
            <QuickActionsWidget
              patientId={profile.id}
              onFileUpload={handleFileUpload}
              onOpenCareGuide={handleOpenCareGuide}
              onOpenRecipe={() => setIsRecipeOpen(true)}
            />
          </motion.div>

          <motion.div variants={item}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-brand-dark">
                {futureAppointments.length > 1
                  ? "Próximas Citas"
                  : "Próxima Cita"}
              </h2>
            </div>
            <AnimatePresence mode="wait">
              {futureAppointments.length > 0 ? (
                <motion.div
                  key="appointments-list"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-col gap-4"
                >
                  {futureAppointments.map((apt) => (
                    <NextAppointmentCard
                      key={apt.id}
                      date={apt.date}
                      time={apt.time}
                      service={apt.serviceName}
                      doctor="Dra. Carmen Torres"
                      location="Consultorio Principal"
                      status={apt.status}
                      onReschedule={() =>
                        navigate("/dashboard/reprogramar", {
                          state: {
                            appointmentId: apt.id,
                            serviceId: apt.serviceId, // AHORA PASAMOS EL UUID DIRECTAMENTE DE LA BD
                            serviceName: apt.serviceName,
                            currentDate: apt.rawDate, // USAMOS LA FECHA ORIGINAL SIN FORMATEAR PARA EVITAR PROBLEMAS DE PARSE
                            currentTime: apt.time,
                          },
                        })
                      }
                      onCancel={() => handleStartCancel(apt)}
                    />
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="empty-state"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-50 border border-slate-100 rounded-3xl p-8 sm:p-12 text-center flex flex-col items-center justify-center gap-3"
                >
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-brand-primary/80 shadow-sm mb-2">
                    <Calendar className="w-8 h-8" />
                  </div>
                  <p className="text-brand-dark font-bold text-lg">
                    Tu agenda está libre
                  </p>
                  <p className="text-brand-gray text-sm">
                    Explora los tratamientos de la Dra. Carmen y agenda cuando
                    gustes.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div variants={item}>
            <ExploreTreatmentsWidget />
          </motion.div>
        </div>

        {/* COLUMNA DERECHA */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <motion.div
            variants={item}
            className="bg-white border border-slate-200 rounded-4xl p-6 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-brand-light flex items-center justify-center text-brand-primary text-3xl font-black mb-4 border-4 border-white shadow-md">
              {profile.firstName.charAt(0)}
            </div>
            <h2 className="text-xl font-bold text-brand-dark">{fullName}</h2>
            <p className="text-sm text-brand-gray font-medium mb-6">
              Paciente Verificado
            </p>
            <div className="flex items-center justify-center gap-6 border-t border-slate-100 pt-6">
              <div className="text-center">
                <p className="text-xs text-brand-gray font-bold uppercase tracking-wider mb-1">
                  Citas
                </p>
                <p className="text-xl font-black text-brand-dark">
                  {String(appointments.length).padStart(2, "0")}
                </p>
              </div>
              <div className="w-px h-8 bg-slate-100"></div>
              <div className="text-center">
                <p className="text-xs text-brand-gray font-bold uppercase tracking-wider mb-1">
                  Estudios
                </p>
                <p className="text-xl font-black text-brand-dark">
                  {String(profile.fileCount).padStart(2, "0")}
                </p>
              </div>
            </div>
          </motion.div>

          {pastAppointments.length > 0 && (
            <motion.div
              variants={item}
              className="bg-white border border-slate-200 rounded-4xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-brand-dark">Citas Pasadas</h3>
              </div>
              <PastAppointmentsList
                appointments={pastAppointments.slice(0, 3).map((apt) => ({
                  id: apt.id, // Ya no usa Number(), respeta el string (UUID)
                  date: apt.date,
                  service: apt.serviceName,
                  serviceId: apt.serviceId, // AHORA PASAMOS EL UUID DIRECTAMENTE
                  doctor: "Dra. Carmen T.",
                }))}
              />
            </motion.div>
          )}

          <motion.div variants={item}>
            <div className="h-58 bg-linear-to-br from-brand-primary to-teal-500 rounded-4xl p-6 text-white text-center shadow-lg shadow-brand-primary/20 relative overflow-hidden">
              <div className="absolute -right-10 -top-10 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
              <h3 className="text-lg font-bold mb-4 relative z-10">
                ¿Necesitas otra consulta?
              </h3>
              <p className="text-teal-50 text-base mb-10 relative z-10">
                Agenda fácil y sin contraseñas.
              </p>
              <Button
                className="w-full bg-white text-brand-primary text-lg font-bold px-0 rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-md relative z-10"
                onClick={() => navigate("/dashboard/agendar")}
                variant="secondary"
              >
                Agendar Nueva Cita
              </Button>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* MODALES */}
      <Modal
        isOpen={cancelState !== "closed"}
        onClose={() => setCancelState("closed")}
        title={cancelState === "confirm" ? "Cancelar Cita" : "Cita Cancelada"}
        icon={
          cancelState === "confirm" ? (
            <AlertTriangle className="w-5 h-5 text-red-500" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-teal-500" />
          )
        }
        hideFooter={true}
      >
        <div className="flex flex-col px-2 pb-2 text-center overflow-hidden">
          <AnimatePresence mode="wait">
            {cancelState === "confirm" && appointmentToCancel && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5 text-red-500">
                  <Calendar className="w-8 h-8 opacity-50 absolute" />
                  <span className="text-2xl font-black relative z-10 -mr-3 mt-3">
                    ×
                  </span>
                </div>
                <h3 className="text-xl font-bold text-brand-dark mb-3">
                  ¿Estás seguro de cancelar?
                </h3>
                <p className="text-base text-brand-gray font-medium mb-8 leading-relaxed">
                  Estás a punto de cancelar tu cita de{" "}
                  <strong className="text-brand-dark">
                    {appointmentToCancel.serviceName}
                  </strong>
                  . <br />
                  <br />
                  Esta acción no se puede deshacer.
                </p>
                <div className="flex flex-col gap-3">
                  <Button
                    onClick={() => setCancelState("closed")}
                    className="w-full py-4 rounded-xl text-base font-bold cursor-pointer"
                  >
                    No, mantener mi cita
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleConfirmCancel}
                    className="w-full py-3.5 rounded-xl text-base font-bold text-red-500 border-red-100 hover:bg-red-50 hover:border-red-200 cursor-pointer"
                  >
                    Sí, cancelar cita
                  </Button>
                </div>
              </motion.div>
            )}
            {cancelState === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, type: "spring" }}
                className="py-6"
              >
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 text-brand-dark shadow-sm border border-red-100">
                  <Trash2 className="w-10 h-10 text-red-400" />
                </div>
                <h3 className="text-2xl font-bold text-brand-dark mb-2">
                  ¡Listo!
                </h3>
                <p className="text-lg text-brand-gray font-medium">
                  Tu cita ha sido cancelada correctamente.
                </p>
                <p className="text-sm text-brand-gray/60 mt-4 animate-pulse">
                  Actualizando tu panel...
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Modal>

      <Modal
        isOpen={isCareGuideOpen}
        onClose={() => setIsCareGuideOpen(false)}
        title="Guía Post-Tratamiento"
        icon={<Leaf className="w-5 h-5 text-violet-500" />}
      >
        <div className="p-4 text-center">
          <p className="text-brand-dark font-medium text-lg leading-relaxed">
            {careGuideText}
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={isRecipeOpen}
        onClose={() => setIsRecipeOpen(false)}
        title="Mis medicamentos"
        icon={<FileText className="w-5 h-5 text-brand-primary" />}
      >
        <div className="px-2 pb-4">
          <PrescriptionDisclaimer className="mb-5" variant="patient" />
          {carePlan.length > 0 ? (
            <>
              <p className="text-brand-gray font-medium mb-6 text-center">
                Indicaciones actuales de la Dra. Carmen Torres para tu
                tratamiento.
              </p>
              <CarePlanWidget plan={carePlan} />
            </>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-brand-dark font-bold text-lg mb-2">
                No tienes medicamentos registrados
              </h3>
              <p className="text-brand-gray text-sm px-4 leading-relaxed">
                Los medicamentos que te indique la Dra. Carmen aparecerán aquí
                después de tu consulta.
              </p>
            </div>
          )}
        </div>
      </Modal>
    </main>
  );
};
