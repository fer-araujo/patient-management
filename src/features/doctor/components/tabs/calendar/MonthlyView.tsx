import { Ban } from "lucide-react";
import type { DashboardAppointment } from "../../../../../lib/services/clinicService";
import type { DashboardBlockedSlot } from "../../../../../lib/services/blockedSlotsService";
import type { WeeklySchedule } from "../../../../../lib/services/settingsService";
import { useCalendar } from "../../../hooks/useCalendar";
import { getServiceColors } from "../../../utils/calendarUtils";

const DAYS_OF_WEEK = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

interface MonthlyViewProps {
  appointments: DashboardAppointment[];
  blockedSlots: DashboardBlockedSlot[];
  onAppointmentClick: (appointment: DashboardAppointment) => void;
  onBlockClick: (block: DashboardBlockedSlot) => void;
  onEmptySlotClick: (date: string, time: string) => void;
}

export const MonthlyView = ({
  appointments,
  blockedSlots,
  onAppointmentClick,
  onBlockClick,
  onEmptySlotClick,
}: MonthlyViewProps) => {
  // 1. EXTRAEMOS EL HORARIO DEL CONTEXTO (No por props)
  const { baseDate, workingSchedule } = useCalendar();

  const currentYear = baseDate.getFullYear();
  const currentMonth = baseDate.getMonth();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // 2. MAGIA UI: Calculamos qué día de la semana cae el día 1 para dejar espacios en blanco
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const BLANK_DAYS = Array.from(
    { length: firstDayOfMonth },
    (_, i) => `blank-${i}`,
  );
  const MONTH_DAYS = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden h-187.5 flex flex-col">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80">
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day}
            className="py-4 text-center border-r border-slate-100 last:border-r-0"
          >
            <span className="text-xs font-black text-brand-gray uppercase tracking-widest">
              {day}
            </span>
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-7 grid-rows-5 bg-slate-100 gap-px">
        {/* Celdas vacías para alinear el día 1 con su día de la semana correcto */}
        {BLANK_DAYS.map((blank) => (
          <div key={blank} className="bg-slate-50/50"></div>
        ))}

        {MONTH_DAYS.map((day) => {
          const cellDate = new Date(currentYear, currentMonth, day);
          const dayOfWeek = cellDate.getDay() as keyof WeeklySchedule;

          // 3. REGLA DE NEGOCIO: Evaluamos si el día está cerrado en el JSON
          const daySchedule = workingSchedule[dayOfWeek];
          const isClosed = !daySchedule?.isOpen;

          const isPast = cellDate < todayDate;
          const isToday = cellDate.getTime() === todayDate.getTime();
          const isUnavailable = isPast || isClosed;

          const dateStr = cellDate
            .toLocaleDateString("es-MX", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
            .replace(/\./g, "")
            .toLowerCase();
          const daysApps = appointments.filter(
            (a) => a.date.toLowerCase() === dateStr,
          );
          const daysBlocks = blockedSlots.filter(
            (b) => b.date.toLowerCase() === dateStr,
          );

          const allEvents = [
            ...daysBlocks.map((b) => ({ type: "block" as const, data: b })),
            ...daysApps.map((a) => ({ type: "appt" as const, data: a })),
          ];

          return (
            <div
              key={day}
              onClick={() => {
                if (!isUnavailable) {
                  // Si hacen clic en un día libre del mes, sugerimos dinámicamente la hora de apertura de ESE día
                  const suggestedTime = daySchedule?.start || "09:00 AM";
                  onEmptySlotClick(dateStr, suggestedTime);
                }
              }}
              className={`p-2 sm:p-3 flex flex-col transition-colors relative group border-b border-slate-100
                ${isUnavailable ? "bg-slate-50 cursor-not-allowed" : "bg-white hover:bg-slate-50 cursor-pointer"}`}
            >
              {!isUnavailable && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <span className="text-[10px] font-bold text-brand-primary bg-brand-light/30 px-2 py-1 rounded shadow-sm">
                    + Agendar
                  </span>
                </div>
              )}

              <div className="flex justify-between items-start mb-2">
                <span
                  className={`text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full 
                  ${isToday ? "bg-brand-primary text-white shadow-sm" : isUnavailable ? "text-slate-400" : "text-brand-dark"}`}
                >
                  {day}
                </span>

                {/* 4. Indicador visual de que la clínica está cerrada ese día */}
                {isClosed && !isPast && (
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                    Cerrado
                  </span>
                )}
              </div>

              <div className="flex-1 space-y-1 overflow-hidden">
                {allEvents.map((event, idx) => {
                  if (idx > 2) return null;

                  if (event.type === "block") {
                    const block = event.data as DashboardBlockedSlot;
                    return (
                      <div
                        key={`block-${block.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isPast) onBlockClick(block);
                        }}
                        className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-1 rounded truncate transition-all
                          ${isPast ? "bg-slate-200/50 text-slate-500 border border-slate-200 cursor-not-allowed" : "bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 cursor-pointer hover:bg-fuchsia-100"}`}
                      >
                        <Ban className="w-3 h-3 shrink-0" />
                        <span>{block.reason}</span>
                      </div>
                    );
                  } else {
                    const app = event.data as DashboardAppointment;
                    return (
                      <div
                        key={`appt-${app.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAppointmentClick(app);
                        }}
                        className={`text-[10px] font-bold px-1.5 py-1 rounded truncate transition-all cursor-pointer border
                          ${getServiceColors(app.service, isPast)} ${!isPast && "hover:shadow-sm hover:scale-[1.02]"}`}
                      >
                        {app.time} - {app.patientName.split(" ")[0]}
                      </div>
                    );
                  }
                })}
                {allEvents.length > 3 && (
                  <p className="text-[10px] font-bold text-brand-primary pl-1 pt-1">
                    +{allEvents.length - 3} más
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
