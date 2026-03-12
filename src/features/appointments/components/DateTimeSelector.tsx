import { useState } from "react";
import { motion, type Variants } from "framer-motion";
import {
  Calendar as CalendarIcon,
  Clock,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";

// Mock data para los días (podríamos generarlos dinámicamente después)
const AVAILABLE_DAYS = [
  { id: "2026-03-12", dayName: "Jue", dayNumber: "12", month: "Mar" },
  { id: "2026-03-13", dayName: "Vie", dayNumber: "13", month: "Mar" },
  { id: "2026-03-16", dayName: "Lun", dayNumber: "16", month: "Mar" },
  { id: "2026-03-17", dayName: "Mar", dayNumber: "17", month: "Mar" },
  { id: "2026-03-18", dayName: "Mié", dayNumber: "18", month: "Mar" },
];

// Mock data para las horas
const AVAILABLE_TIMES = [
  "09:00 AM",
  "09:45 AM",
  "11:30 AM",
  "12:15 PM",
  "04:00 PM",
  "05:30 PM",
];

interface Props {
  onBack: () => void;
  onSubmit: (date: string, time: string) => void;
}

export const DateTimeSelector = ({ onBack, onSubmit }: Props) => {
  const [selectedDay, setSelectedDay] = useState<string | null>(
    AVAILABLE_DAYS[0].id,
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDay && selectedTime) {
      onSubmit(selectedDay, selectedTime);
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

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.4 }}
      className="max-w-xl w-full mx-auto lg:mx-0 py-4"
    >
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full bg-brand-light/40 flex items-center justify-center text-brand-primary hover:bg-brand-light/70 transition-colors shrink-0"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
        </button>
        <div className="inline-flex items-center gap-2.5 px-3 py-1.5 bg-brand-light/50 rounded-full border border-brand-light">
          <p className="text-[11px] font-bold text-brand-dark tracking-wider uppercase">
            Paso 2 de 2: Horario
          </p>
        </div>
      </div>

      <h2 className="text-4xl sm:text-5xl font-bold text-brand-dark mb-4 leading-tight tracking-tight">
        ¿Cuándo te <br /> viene bien?
      </h2>

      <p className="text-lg text-brand-gray/80 font-medium mb-8 max-w-md">
        Selecciona el día y la hora de tu preferencia.
      </p>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* SELECTOR DE DÍAS (Scroll Horizontal) */}
        <motion.div variants={container} initial="hidden" animate="show">
          <div className="flex items-center gap-2 mb-4">
            <CalendarIcon className="w-5 h-5 text-brand-primary" />
            <h3 className="text-xl font-bold text-brand-dark">Marzo 2026</h3>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-4 snap-x hide-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
            {AVAILABLE_DAYS.map((day) => {
              const isSelected = selectedDay === day.id;
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => {
                    setSelectedDay(day.id);
                    setSelectedTime(null); // Reseteamos la hora al cambiar de día
                  }}
                  className={`snap-center shrink-0 flex flex-col items-center justify-center w-20 h-24 rounded-3xl border-2 transition-all ${
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

        {/* SELECTOR DE HORAS (Grid de Pastillas) */}
        <motion.div variants={item} className="pt-2">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-brand-primary" />
            <h3 className="text-xl font-bold text-brand-dark">
              Horarios Disponibles
            </h3>
          </div>

          {selectedDay ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {AVAILABLE_TIMES.map((time) => {
                const isSelected = selectedTime === time;
                return (
                  <button
                    key={time}
                    type="button"
                    onClick={() => setSelectedTime(time)}
                    className={`py-3.5 px-2 rounded-2xl font-bold text-sm sm:text-base border-2 transition-all ${
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
            <div className="bg-slate-50 border border-brand-light/50 rounded-2xl p-6 text-center">
              <p className="text-brand-gray font-medium">
                Selecciona un día primero.
              </p>
            </div>
          )}
        </motion.div>

        {/* BOTÓN DE CONFIRMACIÓN */}
        <motion.div
          variants={item}
          className="pt-6 border-t border-brand-light"
        >
          <Button
            type="submit"
            disabled={!selectedDay || !selectedTime}
            className="w-full sm:w-fit group px-8 py-4 rounded-full text-lg disabled:opacity-50 transition-all flex items-center justify-center gap-3"
          >
            <span>Confirmar Cita</span>
            {selectedDay && selectedTime && (
              <CheckCircle2 className="w-6 h-6 animate-in zoom-in" />
            )}
          </Button>
        </motion.div>
      </form>
    </motion.div>
  );
};
