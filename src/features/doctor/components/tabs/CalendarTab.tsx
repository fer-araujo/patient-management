import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  User,
  Phone,
  Calendar as CalendarIcon,
  FileText,
  Plus,
  MessageSquare,
  Settings,
} from "lucide-react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DatePicker } from "../../../../components/ui/DatePicker";
import {
  MOCK_APPOINTMENTS,
  type AppointmentData,
} from "../../../../data/mockPatients";

import { WeeklyView } from "./calendar/WeeklyView";
import { DailyView } from "./calendar/DailyView";
import { MonthlyView } from "./calendar/MonthlyView";

// Interface para que el cascarón (DoctorDashboard) maneje la navegación
interface CalendarTabProps {
  onStartConsultation: (appointment: AppointmentData) => void;
}

export const CalendarTab = ({ onStartConsultation }: CalendarTabProps) => {
  const confirmedAppointments = useMemo(
    () => MOCK_APPOINTMENTS.filter((app) => app.status === "confirmed"),
    [],
  );

  // Opciones Dinámicas para los Dropdowns basadas en el Mock
  const patientOptions = useMemo(() => {
    const uniqueNames = Array.from(
      new Set(MOCK_APPOINTMENTS.map((app) => app.patientName)),
    );
    return [
      ...uniqueNames.map((name) => ({ label: name, value: name })),
      { label: "+ Crear nuevo paciente", value: "new", disabled: true },
    ];
  }, []);

  const serviceOptions = useMemo(() => {
    const uniqueServices = Array.from(
      new Set(MOCK_APPOINTMENTS.map((app) => app.service)),
    );
    return uniqueServices.map((service) => ({
      label: service,
      value: service,
    }));
  }, []);

  const [calendarView, setCalendarView] = useState<"day" | "week" | "month">(
    "week",
  );

  // Estados para Modales
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentData | null>(null);
  const [actionModal, setActionModal] = useState<{
    date: string;
    time: string;
  } | null>(null);
  const [actionTab, setActionTab] = useState<"schedule" | "block">("schedule");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  // Estados de Formularios (Dropdowns y DatePickers)
  const [selectedPatient, setSelectedPatient] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [blockStartDate, setBlockStartDate] = useState("");
  const [blockEndDate, setBlockEndDate] = useState("");
  const [blockReason, setBlockReason] = useState("comida");

  // Settings de Horario
  const [workingHours, setWorkingHours] = useState({
    start: "08:00 AM",
    end: "08:00 PM",
  });

  const [isStartPickerOpen, setIsStartPickerOpen] = useState(false);
  const [isEndPickerOpen, setIsEndPickerOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* ========================================================
          HEADER DEL CALENDARIO
          ======================================================== */}
      <div className="flex flex-col xl:flex-row items-center justify-between gap-4 bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-4 w-full xl:w-auto">
          <div className="w-12 h-12 bg-brand-light/30 text-brand-primary rounded-xl flex items-center justify-center shrink-0">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-brand-dark leading-tight">
              Marzo 2026
            </h2>
            <p className="text-sm font-medium text-brand-gray mt-1">
              {calendarView === "day"
                ? "16 de Marzo, Lunes"
                : calendarView === "week"
                  ? "16 - 20 de Marzo"
                  : "Mes completo"}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full xl:w-auto">
          <Button
            variant="outline"
            onClick={() => setSettingsModalOpen(true)}
            className="hidden xl:flex px-4 py-2 rounded-xl border-slate-200 text-brand-gray hover:bg-slate-50 cursor-pointer items-center gap-2"
          >
            <Settings className="w-4 h-4" /> Horarios de Clínica
          </Button>

          <div className="flex items-center bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-full sm:w-auto justify-center">
            {(["day", "week", "month"] as const).map((view) => (
              <button
                key={view}
                onClick={() => setCalendarView(view)}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all capitalize cursor-pointer ${calendarView === view ? "bg-white text-brand-dark shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
              >
                {view === "day" ? "Día" : view === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 shrink-0">
            <Button
              variant="outline"
              className="p-2 rounded-xl border-none bg-white shadow-sm text-brand-dark cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <span className="font-bold text-sm px-3">
              {calendarView === "day"
                ? "Hoy"
                : calendarView === "week"
                  ? "Semana Actual"
                  : "Este Mes"}
            </span>
            <Button
              variant="outline"
              className="p-2 rounded-xl border-none bg-white shadow-sm text-brand-dark cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ========================================================
          RENDERIZADO DINÁMICO DE VISTAS
          ======================================================== */}
      <AnimatePresence mode="wait">
        {calendarView === "day" && (
          <motion.div
            key="day"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <DailyView
              appointments={confirmedAppointments}
              onAppointmentClick={setSelectedAppointment}
              onEmptySlotClick={(date, time) => {
                setActionModal({ date, time });
                setActionTab("schedule");
              }}
            />
          </motion.div>
        )}
        {calendarView === "week" && (
          <motion.div
            key="week"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <WeeklyView
              appointments={confirmedAppointments}
              onAppointmentClick={setSelectedAppointment}
              onEmptySlotClick={(date, time) => {
                setActionModal({ date, time });
                setActionTab("schedule");
              }}
            />
          </motion.div>
        )}
        {calendarView === "month" && (
          <motion.div
            key="month"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <MonthlyView
              appointments={confirmedAppointments}
              onAppointmentClick={setSelectedAppointment}
              onEmptySlotClick={(date, time) => {
                setActionModal({ date, time });
                setActionTab("schedule");
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========================================================
          MODAL 1: PRE-CONSULTA (ESTILO PREMIUM)
          ======================================================== */}
      <Modal
        isOpen={!!selectedAppointment}
        onClose={() => setSelectedAppointment(null)}
        title="Detalles de la Cita"
        icon={<User className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        {selectedAppointment && (
          <div className="bg-slate-50/50 -m-6 p-6 space-y-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-brand-dark shrink-0 overflow-hidden border-2 border-white shadow-sm">
                <User className="w-8 h-8 text-brand-gray" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-brand-dark leading-none">
                  {selectedAppointment.patientName}
                </h3>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2 text-sm font-medium text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />{" "}
                    {selectedAppointment.phone}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
              <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-primary" /> Razón de
                Consulta / Notas
              </h4>
              <div className="bg-slate-50 p-3 rounded-xl text-sm font-medium text-brand-dark leading-relaxed">
                {selectedAppointment.isNewPatient ? (
                  "Paciente de primera vez. Agendó consulta mediante el portal web."
                ) : (
                  <span className="italic text-slate-600">
                    "Acude a seguimiento. Sugerir retoque en área frontal. Piel
                    con tendencia a sequedad." (Nota de la última cita)
                  </span>
                )}
              </div>
            </div>

            {/* Mensaje al paciente (Visible en su portal) */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
              <label className="text-brand-dark font-bold text-sm mb-2 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-brand-primary" />{" "}
                Instrucciones previas para el paciente
              </label>
              <textarea
                placeholder="Ej: Recuerda asistir con la cara lavada y sin maquillaje..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-brand-primary focus:bg-white outline-none resize-none h-16 transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest mb-1">
                  Fecha
                </h4>
                <p className="font-bold text-brand-dark">
                  {selectedAppointment.date}
                </p>
                <p className="text-sm font-medium text-slate-500">
                  {selectedAppointment.time} (45 Min)
                </p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <h4 className="text-xs font-black text-brand-gray uppercase tracking-widest mb-1">
                  Tipo
                </h4>
                <p className="font-bold text-brand-primary">
                  {selectedAppointment.service}
                </p>
                <p className="text-sm font-medium text-slate-500">
                  Dra. Carmen Torres
                </p>
              </div>
            </div>

            <div className="pt-4 flex gap-3 bg-white -mx-6 -mb-6 p-6 border-t border-slate-200">
              <Button
                variant="outline"
                onClick={() => setSelectedAppointment(null)}
                className="flex-1 py-3.5 rounded-xl cursor-pointer font-bold"
              >
                Cerrar
              </Button>
              <Button
                onClick={() => {
                  if (selectedAppointment)
                    onStartConsultation(selectedAppointment);
                  setSelectedAppointment(null);
                }}
                className="flex-1 py-3.5 rounded-xl cursor-pointer bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md"
              >
                Iniciar Consulta
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================
          MODAL 2: GESTIÓN DE AGENDA
          ======================================================== */}
      <Modal
        isOpen={!!actionModal}
        onClose={() => setActionModal(null)}
        title="Gestión de Agenda"
        icon={<Plus className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        {actionModal && (
          <div className="space-y-6 pb-2">
            {" "}
            {/* EL FIX: Adiós al pb-40 feo, regresamos a pb-2 */}
            <div className="flex p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setActionTab("schedule")}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all cursor-pointer ${actionTab === "schedule" ? "bg-white text-brand-primary shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
              >
                Agendar Cita
              </button>
              <button
                onClick={() => setActionTab("block")}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all cursor-pointer ${actionTab === "block" ? "bg-brand-primary text-white shadow-sm" : "text-brand-gray hover:text-brand-dark"}`}
              >
                Bloquear Horario
              </button>
            </div>
            {/* TAB: AGENDAR */}
            {actionTab === "schedule" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                <div className="bg-brand-light/20 border border-brand-light/50 rounded-xl p-3 flex justify-between items-center text-sm">
                  <span className="text-brand-gray font-medium">Horario:</span>
                  <span className="font-bold text-brand-primary">
                    {actionModal.date} a las {actionModal.time}
                  </span>
                </div>

                {/* FIX DE Z-INDEX: Le damos z-50 al de arriba y z-40 al de abajo */}
                <div className="relative z-50">
                  <label className="text-brand-dark font-bold text-sm mb-2 block">
                    Buscar Paciente
                  </label>
                  <Dropdown
                    options={patientOptions}
                    value={selectedPatient}
                    onChange={setSelectedPatient}
                    placeholder="Buscar por nombre..."
                    searchable={true}
                  />
                </div>

                <div className="relative z-40">
                  <label className="text-brand-dark font-bold text-sm mb-2 block">
                    Servicio a realizar
                  </label>
                  <Dropdown
                    options={serviceOptions}
                    value={selectedService}
                    onChange={setSelectedService}
                    placeholder="Seleccione un servicio..."
                  />
                </div>

                <Button className="w-full py-3.5 rounded-xl bg-brand-primary hover:opacity-90 text-white mt-4 cursor-pointer border-none shadow-md">
                  Confirmar Cita
                </Button>
              </motion.div>
            )}
            {/* TAB: BLOQUEAR */}
            {actionTab === "block" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3 relative">
                  <div>
                    <label className="text-brand-dark font-bold text-sm mb-2 block">
                      Desde
                    </label>
                    <button
                      onClick={() => setIsStartPickerOpen(!isStartPickerOpen)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left transition-all flex items-center justify-between group cursor-pointer"
                    >
                      <span
                        className={
                          blockStartDate ? "text-brand-dark" : "text-brand-gray"
                        }
                      >
                        {blockStartDate || "Seleccionar..."}
                      </span>
                      <CalendarIcon className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
                    </button>
                    <div className="absolute top-full mt-2 z-50">
                      <DatePicker
                        isOpen={isStartPickerOpen}
                        onClose={() => setIsStartPickerOpen(false)}
                        selectedDate={blockStartDate}
                        onSelectDate={(d) => {
                          setBlockStartDate(d);
                          setIsStartPickerOpen(false);
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-brand-dark font-bold text-sm mb-2 block">
                      Hasta
                    </label>
                    <button
                      onClick={() => setIsEndPickerOpen(!isEndPickerOpen)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-left transition-all flex items-center justify-between group cursor-pointer"
                    >
                      <span
                        className={
                          blockEndDate ? "text-brand-dark" : "text-brand-gray"
                        }
                      >
                        {blockEndDate || "Seleccionar..."}
                      </span>
                      <CalendarIcon className="w-4 h-4 text-brand-gray group-hover:text-brand-primary transition-colors" />
                    </button>
                    <div className="absolute top-full right-0 mt-2 z-50">
                      <DatePicker
                        isOpen={isEndPickerOpen}
                        onClose={() => setIsEndPickerOpen(false)}
                        selectedDate={blockEndDate}
                        minDate={blockStartDate}
                        onSelectDate={(d) => {
                          setBlockEndDate(d);
                          setIsEndPickerOpen(false);
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-brand-dark font-bold text-sm mb-3 block">
                    Motivo
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "comida", label: "Comida" },
                      { id: "junta", label: "Junta" },
                      { id: "personal", label: "Personal" },
                      { id: "vacaciones", label: "Vacaciones" },
                    ].map((reason) => (
                      <button
                        key={reason.id}
                        onClick={() => setBlockReason(reason.id)}
                        className={`py-2 px-2 rounded-lg border text-xs font-bold transition-all cursor-pointer ${blockReason === reason.id ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 bg-white text-brand-gray hover:border-slate-300"}`}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Button className="w-full py-3.5 rounded-xl bg-brand-primary hover:opacity-90 text-white mt-4 cursor-pointer border-none shadow-md">
                  Bloquear Fechas
                </Button>
              </motion.div>
            )}
          </div>
        )}
      </Modal>

      {/* ========================================================
          MODAL 3: CONFIGURACIÓN DE HORARIOS
          ======================================================== */}
      <Modal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        title="Configuración de Horarios"
        icon={<Settings className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        <div className="space-y-6 pb-2">
          <p className="text-brand-gray text-sm">
            Define el horario laboral en el que el calendario y los pacientes
            podrán agendar citas.
          </p>
          <div className="grid grid-cols-2 gap-4 relative z-20">
            <div>
              <label className="text-brand-dark font-bold text-sm mb-2 block">
                Hora de Inicio
              </label>
              <Dropdown
                options={[
                  { label: "07:00 AM", value: "07:00 AM" },
                  { label: "08:00 AM", value: "08:00 AM" },
                  { label: "09:00 AM", value: "09:00 AM" },
                ]}
                value={workingHours.start}
                onChange={(val) =>
                  setWorkingHours({ ...workingHours, start: val })
                }
              />
            </div>
            <div>
              <label className="text-brand-dark font-bold text-sm mb-2 block">
                Hora de Fin
              </label>
              <Dropdown
                options={[
                  { label: "06:00 PM", value: "06:00 PM" },
                  { label: "08:00 PM", value: "08:00 PM" },
                  { label: "10:00 PM", value: "10:00 PM" },
                ]}
                value={workingHours.end}
                onChange={(val) =>
                  setWorkingHours({ ...workingHours, end: val })
                }
              />
            </div>
          </div>
          <Button
            onClick={() => setSettingsModalOpen(false)}
            className="w-full py-3.5 rounded-xl bg-brand-dark hover:bg-slate-800 text-white mt-4 cursor-pointer border-none shadow-md"
          >
            Guardar Horarios
          </Button>
        </div>
      </Modal>
    </motion.div>
  );
};
