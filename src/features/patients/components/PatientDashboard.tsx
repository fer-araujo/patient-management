import { AnimatePresence, motion, type Variants } from "framer-motion";
import { NextAppointmentCard } from "./widgets/NextAppoinmentCard";
// import { CarePlanWidget } from "./widgets/CarePlanWidget";
import { PastAppointmentsList } from "./widgets/PastAppoinmentsList";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/Button";
import { QuickActionsWidget } from "./widgets/QuickActionsWidget";
import { ExploreTreatmentsWidget } from "./widgets/ExploreTratmentsWidget";
import { useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { AlertTriangle, Calendar, CheckCircle2, Trash2 } from "lucide-react";

// Importaciones de los widgets extraídos

const MOCK_PATIENT = {
  name: "María",
  fullName: "María López",
  age: 56,
  nextAppointment: {
    date: "Lunes, 16 de Marzo",
    time: "11:00 AM - 11:45 AM",
    service: "Consulta Anti-Aging & Ozono",
    doctor: "Dra. Carmen Torres",
    location: "Consultorio Principal",
  },
  carePlan: [
    {
      id: 1,
      type: "med",
      name: "Colágeno Hidrolizado",
      instruction: "1 scoop en ayunas",
      daysLeft: "Continuo",
    },
    {
      id: 2,
      type: "care",
      name: "Protector Solar FPS 50+",
      instruction: "Reaplicar cada 4 horas",
      daysLeft: "Diario",
    },
  ],
  pastAppointments: [
    {
      id: 1,
      date: "12 Feb 2026",
      service: "Aplicación de Botox",
      doctor: "Dra. Carmen T.",
    },
    {
      id: 2,
      date: "05 Ene 2026",
      service: "Valoración Inicial",
      doctor: "Dra. Carmen T.",
    },
  ],
};

export const PatientDashboard = () => {
  const navigate = useNavigate();
  const [nextAppointment, setNextAppointment] = useState<
    typeof MOCK_PATIENT.nextAppointment | null
  >(MOCK_PATIENT.nextAppointment);

  const [cancelState, setCancelState] = useState<
    "closed" | "confirm" | "success"
  >("closed");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log("Archivo listo para subir:", file.name);
      alert(`¡Listo! El archivo ${file.name} se enviará a la doctora.`);
    }
  };

  const handleConfirmCancel = () => {
    // Aquí iría tu llamada a la API: await api.cancelAppointment(...)
    console.log("Cancelando cita en BD...");
    setCancelState("success");

    setTimeout(() => {
      setCancelState("closed");
      // 3. AFECTAMOS EL ESTADO REAL DEL COMPONENTE PADRE
      setNextAppointment(null);
    }, 2000);
  };

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const item: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 xl:pt-10">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14"
      >
        {/* ========================================================
            COLUMNA IZQUIERDA (70%)
            ======================================================== */}
        <div className="lg:col-span-8 space-y-8">
          <motion.div variants={item}>
            <h1 className="text-3xl xl:text-4xl font-extrabold text-brand-dark tracking-tight mb-1">
              Hola, {MOCK_PATIENT.name}.
            </h1>
            <p className="text-lg text-brand-gray font-medium">
              {nextAppointment ? (
                <>
                  Tienes{" "}
                  <span className="text-brand-primary font-bold">1 cita</span>{" "}
                  programada para esta semana.
                </>
              ) : (
                "No tienes citas próximas agendadas."
              )}
            </p>
          </motion.div>

          <motion.div
            variants={item}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <QuickActionsWidget onFileUpload={handleFileUpload} />
          </motion.div>

          {/* WIDGET: PRÓXIMA CITA */}
          <motion.div variants={item}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-brand-dark">
                Próxima Cita
              </h2>
            </div>

            <AnimatePresence mode="wait">
              {nextAppointment ? (
                <motion.div
                  key="appointment-card"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{
                    opacity: 0,
                    scale: 0.95,
                    height: 0,
                    overflow: "hidden",
                  }}
                  transition={{ duration: 0.3 }}
                >
                  <NextAppointmentCard
                    {...nextAppointment}
                    status="confirmed" // En prod: nextAppointment.status
                    onReschedule={() => navigate("/dashboard/reprogramar")}
                    onCancel={() => setCancelState("confirm")}
                  />
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

          {/* WIDGET: PLAN DE CUIDADO */}
          <motion.div variants={item}>
            {/* <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-brand-dark">
                Mi Plan de Cuidado
              </h2>
            </div> 
             <CarePlanWidget plan={MOCK_PATIENT.carePlan} /> */}
            <ExploreTreatmentsWidget />
          </motion.div>
        </div>

        {/* ========================================================
            COLUMNA DERECHA (30%)
            ======================================================== */}
        <div className="lg:col-span-4 space-y-6">
          {/* PERFIL */}
          <motion.div
            variants={item}
            className="bg-white border border-slate-200 rounded-4xl p-6 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          >
            <div className="w-24 h-24 mx-auto rounded-full bg-brand-light flex items-center justify-center text-brand-primary text-3xl font-black mb-4 border-4 border-white shadow-md">
              {MOCK_PATIENT.fullName.charAt(0)}
            </div>
            <h2 className="text-xl font-bold text-brand-dark">
              {MOCK_PATIENT.fullName}
            </h2>
            <p className="text-sm text-brand-gray font-medium mb-6">
              {MOCK_PATIENT.age} años
            </p>

            <div className="flex items-center justify-center gap-6 border-t border-slate-100 pt-6">
              <div className="text-center">
                <p className="text-xs text-brand-gray font-bold uppercase tracking-wider mb-1">
                  Citas
                </p>
                <p className="text-xl font-black text-brand-dark">04</p>
              </div>
              <div className="w-px h-8 bg-slate-100"></div>
              <div className="text-center">
                <p className="text-xs text-brand-gray font-bold uppercase tracking-wider mb-1">
                  Estudios
                </p>
                <p className="text-xl font-black text-brand-dark">02</p>
              </div>
            </div>
          </motion.div>

          {/* WIDGET: HISTORIAL RÁPIDO */}
          <motion.div
            variants={item}
            className="bg-white border border-slate-200 rounded-4xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-brand-dark">Citas Pasadas</h3>
            </div>
            <PastAppointmentsList
              appointments={MOCK_PATIENT.pastAppointments}
            />
          </motion.div>

          {/* CTA FLOTANTE */}
          <motion.div variants={item}>
            <div className="bg-linear-to-br from-brand-primary to-teal-500 rounded-4xl p-6 text-white text-center shadow-lg shadow-brand-primary/20 relative overflow-hidden">
              <div className="absolute -right-10 -top-10 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
              <h3 className="text-lg font-bold mb-2 relative z-10">
                ¿Necesitas otra consulta?
              </h3>
              <p className="text-teal-50 text-sm mb-6 relative z-10">
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
            {/* ESTADO 1: CONFIRMACIÓN */}
            {cancelState === "confirm" && (
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
                    {MOCK_PATIENT.nextAppointment.service}
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
                    onClick={handleConfirmCancel} // Llamamos a nuestra función con timeout
                    className="w-full py-3.5 rounded-xl text-base font-bold text-red-500 border-red-100 hover:bg-red-50 hover:border-red-200 cursor-pointer"
                  >
                    Sí, cancelar cita
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ESTADO 2: ÉXITO DE CANCELACIÓN */}
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
    </main>
  );
};
