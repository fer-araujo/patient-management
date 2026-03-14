import { useState, useMemo } from "react";
import { motion, type Variants } from "framer-motion";
import {
  Calendar as CalendarIcon,
  Clock,
  ArrowLeft,
  CheckCircle2,
  CalendarSearch,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DatePicker } from "../../../components/ui/DatePicker";

const SHORT_DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Usamos formato de 24hrs interno para comparar más fácil, pero mostramos formato 12hrs
const RAW_TIMES = [
  { time24: "09:00", display: "09:00 AM" },
  { time24: "09:45", display: "09:45 AM" },
  { time24: "11:30", display: "11:30 AM" },
  { time24: "12:15", display: "12:15 PM" },
  { time24: "16:00", display: "04:00 PM" },
  { time24: "17:30", display: "05:30 PM" },
];

interface Props {
  initialDate?: string;
  initialTime?: string;
  isDirectMode?: boolean;
  onBack: () => void;
  onSubmit: (date: string, time: string) => void;
}

export const DateTimeSelector = ({
  initialDate,
  initialTime,
  isDirectMode = false,
  onBack,
  onSubmit,
}: Props) => {
  // Lógica para obtener la fecha de arranque "inteligente"
  const getSmartStartDate = () => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Si ya pasaron las 17:30 (la última cita), arrancar mañana
    if (
      now.getHours() >= 17 ||
      (now.getHours() === 17 && now.getMinutes() >= 30)
    ) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    }
    return todayStr;
  };

  // Necesitamos el "hoy real" para bloquear fechas pasadas en el Modal
  const realTodayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const smartStartStr = useMemo(() => getSmartStartDate(), []);

  const [selectedDay, setSelectedDay] = useState<string | null>(
    initialDate || smartStartStr,
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(
    initialTime || null,
  );
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const [visibleStartDate, setVisibleStartDate] = useState<string>(
    initialDate || smartStartStr,
  );

  const visibleDays = useMemo(() => {
    const baseDate = new Date(`${visibleStartDate}T12:00:00`);
    return Array.from({ length: 5 }).map((_, i) => {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + i);
      return {
        id: d.toISOString().split("T")[0],
        dayName: SHORT_DAY_NAMES[d.getDay()],
        dayNumber: String(d.getDate()),
      };
    });
  }, [visibleStartDate]);

  // ============================================================================
  // FILTRO INTELIGENTE DE HORARIOS
  // ============================================================================
  const availableTimesForSelectedDay = useMemo(() => {
    if (!selectedDay) return [];

    const now = new Date();
    const isToday = selectedDay === realTodayStr;

    // Si no es hoy, devolvemos todos los horarios
    if (!isToday) return RAW_TIMES.map((t) => t.display);

    // Si es hoy, filtramos los que ya pasaron
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    return RAW_TIMES.filter((t) => {
      const [hourStr, minStr] = t.time24.split(":");
      const hour = parseInt(hourStr, 10);
      const min = parseInt(minStr, 10);

      // Solo dejamos las horas futuras (le damos 1 hora de margen para que no agenden "ahorita")
      // Ej: Si son las 9:15, no pueden agendar a las 9:45. Tienen que agendar a las 11:30.
      if (hour > currentHour + 1) return true;
      if (hour === currentHour + 1 && min > currentMinute) return true;
      return false;
    }).map((t) => t.display);
  }, [selectedDay, realTodayStr]);

  // ============================================================================

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDay && selectedTime) onSubmit(selectedDay, selectedTime);
  };

  const handleModalDateSelect = (date: string) => {
    setSelectedDay(date);
    setSelectedTime(null);

    const selectedTimeMs = new Date(`${date}T12:00:00`).getTime();
    const startTimeMs = new Date(`${visibleStartDate}T12:00:00`).getTime();
    const endTimeMs = startTimeMs + 4 * 24 * 60 * 60 * 1000;

    if (selectedTimeMs < startTimeMs || selectedTimeMs > endTimeMs) {
      setVisibleStartDate(date);
    }
  };

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  };

  const currentMonthName = new Date(
    `${visibleStartDate}T12:00:00`,
  ).toLocaleDateString("es-MX", { month: "long", year: "numeric" });

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

        <form onSubmit={handleSubmit} className="space-y-8">
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
                    className={`cursor-pointer snap-center shrink-0 flex flex-col items-center justify-center w-20 h-24 rounded-3xl border-2 transition-all ${
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {availableTimesForSelectedDay.map((time) => {
                    const isSelected = selectedTime === time;
                    return (
                      <button
                        key={time}
                        type="button"
                        onClick={() => setSelectedTime(time)}
                        className={`cursor-pointer py-3.5 px-2 rounded-2xl font-bold text-sm sm:text-base border-2 transition-all ${
                          isSelected
                            ? "bg-brand-dark border-brand-dark text-white shadow-md"
                            : "bg-white border-brand-light hover:border-brand-dark/30 text-brand-dark"
                        }`}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-slate-50 border border-brand-light/50 rounded-2xl p-6 text-center flex flex-col items-center gap-2">
                  <span className="text-2xl">🌙</span>
                  <p className="text-brand-dark font-bold">
                    Sin horarios disponibles
                  </p>
                  <p className="text-brand-gray font-medium text-sm">
                    Ya no hay citas para el día de hoy. Por favor, selecciona
                    otro día.
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

          <motion.div
            variants={item}
            className="pt-6 border-t border-brand-light"
          >
            <Button
              type="submit"
              disabled={!selectedDay || !selectedTime}
              className="w-full sm:w-fit px-8 rounded-full text-lg disabled:opacity-50 transition-all cursor-pointer"
            >
              Confirmar Cita
              {selectedDay && selectedTime && (
                <CheckCircle2 className="w-6 h-6 animate-in zoom-in" />
              )}
            </Button>
          </motion.div>
        </form>
      </motion.div>

      <DatePicker
        isOpen={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        selectedDate={selectedDay}
        minDate={smartStartStr} // Bloqueamos el calendario para que no puedan elegir el "hoy" si ya acabó su jornada
        onSelectDate={handleModalDateSelect}
      />
    </>
  );
};
