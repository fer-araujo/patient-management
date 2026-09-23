import { useState, useMemo, useEffect } from "react";
import { motion, type Variants } from "framer-motion";
import {
  Calendar as CalendarIcon,
  Clock,
  ArrowLeft,
  CheckCircle2,
  CalendarSearch,
  Loader2,
  Sun,
  CloudSun,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DatePicker } from "../../../components/ui/DatePicker";
import { fetchActiveServices } from "../../../lib/services/catalogService";
// Patient-facing screens only ever see opaque busy ranges and the opening
// hours; they never read the appointment, block or settings tables.
import {
  fetchPublicAvailability,
  fetchPublicSchedule,
  type BusyRange,
} from "../../../lib/services/availabilityService";
import { type WeeklySchedule } from "../../../lib/services/settingsService";
import {
  getAvailableTimeOptionsFromBusy,
  filterFutureTimesOnly,
} from "../../doctor/utils/calendarUtils";

const SHORT_DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** How far ahead the booking calendar may be browsed. */
const AVAILABILITY_WINDOW_DAYS = 120;

interface Props {
  serviceId: string;
  initialDate?: string;
  initialTime?: string;
  isDirectMode?: boolean;
  onBack: () => void;
  onSubmit: (date: string, time: string) => void;
}

// FIX: Sacamos la función del componente para que no se re-cree y sea más pura
const getSmartStartDate = (schedule: WeeklySchedule) => {
  const now = new Date();
  if (
    now.getHours() >= 17 ||
    (now.getHours() === 17 && now.getMinutes() >= 30)
  ) {
    now.setDate(now.getDate() + 1);
  }

  for (let i = 0; i < 7; i++) {
    const dayOfWeek = now.getDay() as keyof WeeklySchedule;
    if (schedule[dayOfWeek]?.isOpen) {
      break;
    }
    now.setDate(now.getDate() + 1);
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export const DateTimeSelector = ({
  serviceId,
  initialDate,
  initialTime,
  isDirectMode = false,
  onBack,
  onSubmit,
}: Props) => {
  const [isLoading, setIsLoading] = useState(true);
  const [serviceDuration, setServiceDuration] = useState<number>(60);
  const [busyRanges, setBusyRanges] = useState<BusyRange[]>([]);

  // Dejamos este estado como "Fallback" por si falla la red, pero se sobreescribirá
  const [workingSchedule, setWorkingSchedule] = useState<WeeklySchedule>({
    1: { isOpen: true, start: "09:00 AM", end: "06:00 PM" },
    2: { isOpen: true, start: "09:00 AM", end: "06:00 PM" },
    3: { isOpen: true, start: "09:00 AM", end: "06:00 PM" },
    4: { isOpen: true, start: "09:00 AM", end: "06:00 PM" },
    5: { isOpen: true, start: "09:00 AM", end: "06:00 PM" },
    6: { isOpen: true, start: "09:00 AM", end: "02:00 PM" },
    0: { isOpen: false, start: "09:00 AM", end: "06:00 PM" },
  });

  // Iniciamos las fechas vacías para no hacer un render prematuro con datos falsos
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(
    initialTime || null,
  );
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [visibleStartDate, setVisibleStartDate] = useState<string>("");

  useEffect(() => {
    const loadAgendaData = async () => {
      try {
        const rangeStart = new Date();
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeEnd.getDate() + AVAILABILITY_WINDOW_DAYS);

        const [servicesData, busyData, scheduleData] = await Promise.all([
          fetchActiveServices(),
          fetchPublicAvailability(rangeStart, rangeEnd),
          fetchPublicSchedule(),
        ]);

        const selectedService = servicesData.find((s) => s.id === serviceId);
        if (selectedService) {
          setServiceDuration(selectedService.durationMins);
        }

        setBusyRanges(busyData);

        // FIX: Si la BD nos regresa datos, sobreescribimos la mentira hardcodeada
        const finalSchedule = scheduleData || workingSchedule;
        if (scheduleData) setWorkingSchedule(scheduleData);

        // AHORA SÍ calculamos la fecha inteligente basada en los horarios REALES
        const realSmartStart = getSmartStartDate(finalSchedule);
        setSelectedDay(initialDate || realSmartStart);
        setVisibleStartDate(initialDate || realSmartStart);
      } catch (error) {
        console.error("Error al cargar la agenda:", error);
      } finally {
        setIsLoading(false); // Quitamos el loader hasta que TODA la verdad esté calculada
      }
    };
    loadAgendaData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  const isDateDisabled = (dateStr: string) => {
    const date = new Date(dateStr);
    return !workingSchedule[date.getDay()].isOpen;
  };

  const visibleDays = useMemo(() => {
    if (!visibleStartDate) return []; // Seguro contra renders prematuros
    const days = [];
    const currentDate = new Date(`${visibleStartDate}T12:00:00`);

    while (days.length < 5) {
      const dayOfWeek = currentDate.getDay() as keyof WeeklySchedule;
      // Esto ahora saltará el Viernes si la doctora lo cerró en su panel
      if (workingSchedule[dayOfWeek]?.isOpen) {
        days.push({
          id: currentDate.toISOString().split("T")[0],
          dayName: SHORT_DAY_NAMES[currentDate.getDay()],
          dayNumber: String(currentDate.getDate()),
        });
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return days;
  }, [visibleStartDate, workingSchedule]);

  const availableTimesForSelectedDay = useMemo(() => {
    if (!selectedDay || isLoading || !workingSchedule) return [];

    const options = getAvailableTimeOptionsFromBusy(
      selectedDay,
      busyRanges,
      workingSchedule,
      serviceDuration,
    );

    const allTimes12h = options.map((opt) => opt.value);
    return filterFutureTimesOnly(allTimes12h, selectedDay);
  }, [
    selectedDay,
    isLoading,
    busyRanges,
    workingSchedule,
    serviceDuration,
  ]);

  const morningSlots = useMemo(
    () => availableTimesForSelectedDay.filter((t) => t.includes("AM")),
    [availableTimesForSelectedDay],
  );
  const afternoonSlots = useMemo(
    () => availableTimesForSelectedDay.filter((t) => t.includes("PM")),
    [availableTimesForSelectedDay],
  );

  useEffect(() => {
    if (
      availableTimesForSelectedDay.length > 0 &&
      selectedTime &&
      !availableTimesForSelectedDay.includes(selectedTime)
    ) {
      setSelectedTime(null);
    }
  }, [availableTimesForSelectedDay, selectedTime]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDay && selectedTime) onSubmit(selectedDay, selectedTime);
  };

  const handleModalDateSelect = (date: string) => {
    setSelectedDay(date);
    setSelectedTime(null);
    setVisibleStartDate(date);
  };

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  };

  // Previene crash si visibleStartDate aún no existe
  const currentMonthName = visibleStartDate
    ? new Date(`${visibleStartDate}T12:00:00`).toLocaleDateString("es-MX", {
        month: "long",
        year: "numeric",
      })
    : "";

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 w-full">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
        <p className="text-brand-gray font-medium">
          Calculando disponibilidad...
        </p>
      </div>
    );
  }

  // ... (EL RESTO DEL JSX SE MANTIENE EXACTAMENTE IGUAL) ...
  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.4 }}
        className="max-w-xl w-full mx-auto lg:mx-0 py-4"
      >
        <div className="flex items-center gap-4 mb-8">
          {isDirectMode ? (
            <>
              <button
                onClick={onBack}
                className="w-10 h-10 cursor-pointer rounded-full bg-brand-light/40 flex items-center justify-center text-brand-primary hover:bg-brand-light/70 transition-colors shrink-0"
              >
                <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
              </button>
              <div className="inline-flex items-center gap-2.5 px-3 py-1.5 bg-brand-light/50 rounded-full border border-brand-light">
                <p className="text-[11px] font-bold text-brand-dark tracking-wider uppercase">
                  Volver
                </p>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={onBack}
                className="w-10 h-10 cursor-pointer rounded-full bg-brand-light/40 flex items-center justify-center text-brand-primary hover:bg-brand-light/70 transition-colors shrink-0"
              >
                <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
              </button>
              <div className="inline-flex items-center gap-2.5 px-3 py-1.5 bg-brand-light/50 rounded-full border border-brand-light">
                <p className="text-[11px] font-bold text-brand-dark tracking-wider uppercase">
                  Paso 2 de 2: Horario
                </p>
              </div>
            </>
          )}
        </div>

        <h2 className="text-4xl sm:text-5xl font-bold text-brand-dark mb-4 leading-tight tracking-tight">
          ¿Cuándo te <br /> viene bien?
        </h2>
        <p className="text-lg text-brand-gray/80 font-medium mb-8 max-w-md">
          Selecciona el día y la hora de tu preferencia.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <motion.div variants={container} initial="hidden" animate="show">
            <div className="flex items-center justify-between mb-4 pr-2">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-brand-primary" />
                <h3 className="text-xl font-bold text-brand-dark capitalize">
                  {currentMonthName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCalendarOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-full hover:bg-brand-light/40 text-brand-primary font-bold text-sm transition-colors"
              >
                <span>Más fechas</span>
                <CalendarSearch className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-4 snap-x hide-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              {visibleDays.map((day) => {
                const isSelected = selectedDay === day.id;
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => {
                      setSelectedDay(day.id);
                      setSelectedTime(null);
                    }}
                    className={`cursor-pointer snap-center shrink-0 flex flex-col items-center justify-center w-20 h-22 rounded-3xl border-2 transition-all ${
                      isSelected
                        ? "bg-brand-primary border-brand-primary text-white shadow-lg shadow-brand-primary/20"
                        : "bg-white border-brand-light hover:border-brand-primary/50 text-brand-dark"
                    }`}
                  >
                    <span
                      className={`text-xs font-bold uppercase tracking-wider mb-1 ${isSelected ? "text-white/90" : "text-brand-gray"}`}
                    >
                      {day.dayName}
                    </span>
                    <span className="text-2xl font-black">{day.dayNumber}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>

          <motion.div variants={item} className="pt-2">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-brand-primary" />
              <h3 className="text-xl font-bold text-brand-dark">
                Horarios Disponibles
              </h3>
            </div>

            {selectedDay ? (
              availableTimesForSelectedDay.length > 0 ? (
                <div className="max-h-65 overflow-y-auto pr-2 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-brand-light [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-brand-primary/50 transition-colors">
                  {morningSlots.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-brand-gray mb-3 flex items-center gap-1.5 uppercase tracking-wider">
                        <Sun className="w-4 h-4" /> Mañana
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {morningSlots.map((time) => {
                          const isSelected = selectedTime === time;
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => setSelectedTime(time)}
                              className={`cursor-pointer py-3 px-2 rounded-xl font-bold text-sm sm:text-base border-2 transition-all ${
                                isSelected
                                  ? "bg-brand-dark border-brand-dark text-white shadow-md"
                                  : "bg-white border-slate-100 hover:border-brand-dark/30 text-brand-dark"
                              }`}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {afternoonSlots.length > 0 && (
                    <div
                      className={
                        morningSlots.length > 0
                          ? "pt-2 border-t border-slate-100"
                          : ""
                      }
                    >
                      <h4 className="text-xs font-bold text-brand-gray mb-3 flex items-center gap-1.5 uppercase tracking-wider">
                        <CloudSun className="w-4 h-4" /> Tarde
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {afternoonSlots.map((time) => {
                          const isSelected = selectedTime === time;
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => setSelectedTime(time)}
                              className={`cursor-pointer py-3 px-2 rounded-xl font-bold text-sm sm:text-base border-2 transition-all ${
                                isSelected
                                  ? "bg-brand-dark border-brand-dark text-white shadow-md"
                                  : "bg-white border-slate-100 hover:border-brand-dark/30 text-brand-dark"
                              }`}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-slate-50 border border-brand-light/50 rounded-2xl p-6 text-center flex flex-col items-center gap-2">
                  <span className="text-2xl">🌙</span>
                  <p className="text-brand-dark font-bold">
                    Sin horarios disponibles
                  </p>
                  <p className="text-brand-gray font-medium text-sm">
                    Ya no hay citas suficientes para la duración de este
                    servicio. Por favor, selecciona otro día.
                  </p>
                </div>
              )
            ) : (
              <div className="bg-slate-50 border border-brand-light/50 rounded-2xl p-6 text-center">
                <p className="text-brand-gray font-medium">
                  Selecciona un día primero.
                </p>
              </div>
            )}
          </motion.div>

          <motion.div variants={item} className="pt-4">
            <Button
              type="submit"
              disabled={!selectedDay || !selectedTime}
              className="w-full sm:w-fit px-8 rounded-full text-lg disabled:opacity-50 transition-all cursor-pointer shadow-md"
            >
              Confirmar Cita
              {selectedDay && selectedTime && (
                <CheckCircle2 className="w-6 h-6 animate-in zoom-in" />
              )}
            </Button>
          </motion.div>
        </form>
      </motion.div>

      {/* Como isDateDisabled ya lee el estado `workingSchedule` actualizado, bloqueará correctamente el DatePicker */}
      <DatePicker
        isOpen={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        selectedDate={selectedDay}
        minDate={visibleStartDate} // Usamos visibleStartDate como mínimo para no permitir viajar al pasado
        onSelectDate={handleModalDateSelect}
        isDateDisabled={isDateDisabled}
      />
    </>
  );
};
