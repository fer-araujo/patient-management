import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  Phone,
  CheckCircle2,
  Lock,
  Calendar as CalendarIcon,
} from "lucide-react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import {
  MOCK_APPOINTMENTS,
  type AppointmentData,
} from "../../../../data/mockPatients";

// Configuraciones del Calendario
const START_HOUR = 8; // 08:00 AM
const END_HOUR = 20; // 08:00 PM
const HOUR_HEIGHT = 80; // Píxeles por hora (para calcular el alto y la posición)
const APPOINTMENT_DURATION = 45; // Minutos estándar por cita (para el alto de la tarjeta)

// Helper para generar el arreglo de horas [8, 9, 10, ... 20]
const HOURS = Array.from(
  { length: END_HOUR - START_HOUR + 1 },
  (_, i) => START_HOUR + i,
);

// Helper para convertir "11:30 AM" a píxeles desde el inicio (08:00 AM)
const timeToPixels = (timeStr: string) => {
  const [time, modifier] = timeStr.split(" ");
  // eslint-disable-next-line prefer-const
  let [hours, minutes] = time.split(":").map(Number);

  if (modifier === "PM" && hours !== 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;

  const totalMinutes = hours * 60 + minutes;
  const startMinutes = START_HOUR * 60;
  const offsetMinutes = totalMinutes - startMinutes;

  return (offsetMinutes / 60) * HOUR_HEIGHT;
};

export const CalendarTab = () => {
  // Tomamos solo las confirmadas para mostrarlas en el calendario
  const confirmedAppointments = useMemo(() => {
    return MOCK_APPOINTMENTS.filter((app) => app.status === "confirmed");
  }, []);

  // ESTADOS PARA MODALES
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentData | null>(null);

  const [blockTimeModal, setBlockTimeModal] = useState<{ time: string } | null>(
    null,
  );
  const [blockReason, setBlockReason] = useState("comida");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* HEADER DEL CALENDARIO */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white border border-slate-200 rounded-3xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-brand-light/30 text-brand-primary rounded-xl flex items-center justify-center shrink-0">
            <span className="text-xl font-black">{new Date().getDate()}</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-brand-dark leading-tight">
              {new Date()
                .toLocaleDateString("es-MX", {
                  weekday: "long",
                  month: "long",
                  year: "numeric",
                })
                .replace(/^\w/, (c) => c.toUpperCase())}
            </h2>
            <p className="text-sm font-medium text-brand-gray">
              Día de Trabajo Actual
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="px-3 py-2 rounded-xl border-slate-200 text-brand-gray hover:bg-slate-50 cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <Button
            variant="outline"
            className="px-4 py-2 rounded-xl border-slate-200 text-brand-dark font-bold hover:bg-slate-50 cursor-pointer"
          >
            Hoy
          </Button>
          <Button
            variant="outline"
            className="px-3 py-2 rounded-xl border-slate-200 text-brand-gray hover:bg-slate-50 cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* EL TIMELINE VERTICAL */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col h-175">
        <div className="flex-1 overflow-y-auto hide-scrollbar relative">
          <div className="flex w-full relative min-h-max">
            {/* COLUMNA IZQUIERDA: Etiquetas de Tiempo */}
            <div className="w-20 shrink-0 border-r border-slate-100 bg-slate-50/50 sticky left-0 z-10">
              {HOURS.map((hour) => {
                const isPM = hour >= 12;
                const displayHour = hour > 12 ? hour - 12 : hour;
                return (
                  <div
                    key={hour}
                    className="relative flex justify-center"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    <span className="text-xs font-bold text-brand-gray absolute -top-2.5 bg-slate-50/50 px-1">
                      {String(displayHour).padStart(2, "0")}:00{" "}
                      {isPM ? "PM" : "AM"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* COLUMNA DERECHA: El Lienzo de Citas */}
            <div
              className="flex-1 relative min-w-150 bg-[linear-gradient(transparent_39px,#f1f5f9_40px,transparent_41px)]"
              style={{ backgroundSize: `100% ${HOUR_HEIGHT / 2}px` }}
            >
              {/* Líneas horizontales de las horas en punto */}
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="absolute w-full border-t border-slate-200"
                  style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
                />
              ))}

              {/* Botones invisibles para bloquear agenda (Click en espacio vacío) */}
              {HOURS.slice(0, -1).map((hour) => {
                const displayHour = hour > 12 ? hour - 12 : hour;
                const isPM = hour >= 12;
                const timeStr = `${String(displayHour).padStart(2, "0")}:00 ${isPM ? "PM" : "AM"}`;

                return (
                  <div
                    key={`slot-${hour}`}
                    onClick={() => setBlockTimeModal({ time: timeStr })}
                    className="absolute w-full opacity-0 hover:opacity-100 hover:bg-slate-100/40 cursor-pointer transition-colors z-0 flex items-center justify-center border-dashed border-2 border-transparent hover:border-slate-300"
                    style={{
                      top: (hour - START_HOUR) * HOUR_HEIGHT,
                      height: HOUR_HEIGHT,
                    }}
                  >
                    <span className="text-sm font-bold text-brand-gray bg-white px-3 py-1 rounded-lg shadow-sm pointer-events-none">
                      + Bloquear / Agendar {timeStr}
                    </span>
                  </div>
                );
              })}

              {/* RENDERIZADO DE LAS CITAS (Absolute Positioning) */}
              {confirmedAppointments.map((app) => {
                const topPosition = timeToPixels(app.time);
                const heightPixels = (APPOINTMENT_DURATION / 60) * HOUR_HEIGHT; // 45 mins de alto

                // Evitamos que se rendericen fuera del rango 8am-8pm
                if (
                  topPosition < 0 ||
                  topPosition > (END_HOUR - START_HOUR) * HOUR_HEIGHT
                )
                  return null;

                return (
                  <div
                    key={app.id}
                    onClick={() => setSelectedAppointment(app)}
                    className="absolute left-2 right-4 rounded-xl border-l-4 border-brand-primary bg-brand-light/20 hover:bg-brand-light/40 transition-colors p-2 sm:p-3 cursor-pointer shadow-sm z-20 overflow-hidden flex flex-col group"
                    style={{ top: topPosition, height: heightPixels }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm sm:text-base font-bold text-brand-dark truncate">
                        {app.patientName}
                      </h4>
                      <span className="text-xs font-bold text-brand-primary whitespace-nowrap hidden sm:block bg-white px-2 py-0.5 rounded-md shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        {app.time}
                      </span>
                    </div>
                    <p className="text-xs text-brand-gray font-medium truncate mt-0.5">
                      {app.service}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          MODAL 1: DETALLES DE LA CITA
          ======================================================== */}
      <Modal
        isOpen={!!selectedAppointment}
        onClose={() => setSelectedAppointment(null)}
        title="Detalle de la Cita"
        icon={<CalendarIcon className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        {selectedAppointment && (
          <div className="space-y-6 pb-2">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center text-brand-dark shrink-0 overflow-hidden">
                <User className="w-6 h-6 text-brand-gray" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-brand-dark">
                  {selectedAppointment.patientName}
                </h3>
                <div className="flex items-center gap-2 mt-1 text-sm font-medium text-slate-500">
                  <Phone className="w-4 h-4" /> {selectedAppointment.phone}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-brand-gray flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-teal-500" /> Servicio
                </span>
                <span className="text-sm font-bold text-brand-dark text-right">
                  {selectedAppointment.service}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-brand-gray flex items-center gap-2">
                  <Clock className="w-4 h-4 text-brand-primary" /> Horario
                </span>
                <span className="text-sm font-bold text-brand-dark bg-brand-light/30 px-2 py-1 rounded-md">
                  {selectedAppointment.time} (45 min)
                </span>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setSelectedAppointment(null)}
                className="flex-1 py-3 rounded-xl cursor-pointer font-bold text-brand-dark"
              >
                Cerrar
              </Button>
              {/* ¡EL BOTÓN MÁGICO PARA IR AL EXPEDIENTE! */}
              <Button
                onClick={() =>
                  alert("Navegando al Expediente Clínico (Tab 2)...")
                }
                className="flex-1 py-3 rounded-xl cursor-pointer"
              >
                Iniciar Consulta
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================
          MODAL 2: BLOQUEAR AGENDA
          ======================================================== */}
      <Modal
        isOpen={!!blockTimeModal}
        onClose={() => setBlockTimeModal(null)}
        title="Bloquear Horario"
        icon={<Lock className="w-5 h-5 text-slate-600" />}
        hideFooter={true}
      >
        {blockTimeModal && (
          <div className="space-y-6 pb-2">
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-center">
              <p className="text-sm font-medium text-brand-gray mb-1">
                Horario seleccionado:
              </p>
              <h3 className="text-2xl font-black text-brand-dark">
                {blockTimeModal.time}
              </h3>
            </div>

            <div>
              <label className="text-brand-dark font-bold text-sm mb-3 block">
                Motivo del bloqueo
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: "comida", label: "Comida" },
                  { id: "junta", label: "Junta Administrativa" },
                  { id: "personal", label: "Asunto Personal" },
                  { id: "quirofano", label: "Procedimiento Largo" },
                ].map((reason) => (
                  <button
                    key={reason.id}
                    onClick={() => setBlockReason(reason.id)}
                    className={`py-3 px-4 rounded-xl border-2 text-sm font-bold transition-all cursor-pointer ${
                      blockReason === reason.id
                        ? "border-slate-800 bg-slate-800 text-white shadow-md"
                        : "border-slate-200 bg-white text-brand-gray hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setBlockTimeModal(null)}
                className="flex-1 py-3 rounded-xl cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  alert(`Horario bloqueado: ${blockTimeModal.time}`);
                  setBlockTimeModal(null);
                }}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white cursor-pointer border-none"
              >
                Confirmar Bloqueo
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
};
