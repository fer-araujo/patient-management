import { Clock, Ban } from "lucide-react";
import { type DashboardAppointment } from "../../../../../lib/services/clinicService";
import { type DashboardBlockedSlot } from "../../../../../lib/services/blockedSlotsService";
import { type WeeklySchedule } from "../../../../../lib/services/settingsService";
import { useCalendar } from "../../../hooks/useCalendar";
import {
  parseHour24,
  timeToPixels,
  getAppointmentColors,
  isTimeSlotInPast,
  isTimeStrInPast,
  HOUR_HEIGHT,
  getGridHoursRange,
} from "../../../utils/calendarUtils";
import { PendingBadge } from "./PendingBadge";
import { SuppliesPendingBadge } from "./SuppliesPendingBadge";

interface WeeklyViewProps {
  appointments: DashboardAppointment[];
  blockedSlots: DashboardBlockedSlot[];
  onAppointmentClick: (appointment: DashboardAppointment) => void;
  onBlockClick: (block: DashboardBlockedSlot) => void;
  onEmptySlotClick: (date: string, time: string) => void;
}

export const WeeklyView = ({
  appointments,
  blockedSlots,
  onAppointmentClick,
  onBlockClick,
  onEmptySlotClick,
}: WeeklyViewProps) => {
  const { baseDate, workingSchedule } = useCalendar();

  const { start: startHour, end: endHour } = getGridHoursRange(workingSchedule);
  const HOURS = Array.from(
    { length: endHour - startHour + 1 },
    (_, i) => startHour + i,
  );

  const dayOfWeek = baseDate.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  // SEIS DÍAS (LUNES A SÁBADO)
  const WEEK_DAYS = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const id = d
      .toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/\./g, "");
    const weekDayName = d
      .toLocaleDateString("es-MX", { weekday: "short" })
      .toUpperCase()
      .replace(/\./g, "");
    const dayNum = String(d.getDate()).padStart(2, "0");
    return { id, name: `${weekDayName} ${dayNum}`, dateObj: d };
  });

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col h-187.5">
      <div className="flex border-b border-slate-200 bg-slate-50/80 sticky top-0 z-20">
        <div className="w-16 sm:w-20 shrink-0 border-r border-slate-200"></div>
        {WEEK_DAYS.map((day) => (
          <div
            key={day.id}
            className="flex-1 py-4 text-center border-r border-slate-100 last:border-r-0"
          >
            <span className="text-xs font-black text-brand-gray uppercase tracking-widest">
              {day.name.split(" ")[0]}
            </span>
            <h3 className="text-lg font-bold text-brand-dark leading-none mt-1">
              {day.name.split(" ")[1]}
            </h3>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto relative bg-white">
        <div className="flex w-full relative min-h-max pt-4 pb-4">
          <div className="w-16 sm:w-20 shrink-0 border-r border-slate-200 bg-white relative z-10">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative flex justify-end pr-2 sm:pr-3"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 absolute -top-2.5 bg-white px-1">
                  {String(hour > 12 ? hour - 12 : hour).padStart(2, "0")}:00{" "}
                  {hour >= 12 ? "PM" : "AM"}
                </span>
              </div>
            ))}
          </div>

          <div className="flex-1 flex relative">
            <div className="absolute inset-0 pointer-events-none">
              {HOURS.map((hour) => (
                <div
                  key={`line-${hour}`}
                  className="w-full border-t border-slate-100"
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}
            </div>

            {WEEK_DAYS.map((day) => {
              const daysAppointments = appointments.filter(
                (app) => app.date.toLowerCase() === day.id.toLowerCase(),
              );
              const daysBlocks = blockedSlots.filter(
                (block) => block.date.toLowerCase() === day.id.toLowerCase(),
              );

              return (
                <div
                  key={day.id}
                  className="flex-1 relative border-r border-slate-100 last:border-r-0 group/col"
                >
                  {/* SLOTS VACÍOS Y BLOQUEO POR DÍA CERRADO (EVALÚA day.dateObj) */}
                  {HOURS.slice(0, -1).map((hour) => {
                    const timeStr = `${String(hour > 12 ? hour - 12 : hour).padStart(2, "0")}:00 ${hour >= 12 ? "PM" : "AM"}`;
                    const isPast = isTimeSlotInPast(day.dateObj, hour);

                    const daySchedule =
                      workingSchedule[
                        day.dateObj.getDay() as keyof WeeklySchedule
                      ];
                    const dayStart = daySchedule?.isOpen
                      ? parseHour24(daySchedule.start)
                      : 24;
                    const dayEnd = daySchedule?.isOpen
                      ? parseHour24(daySchedule.end)
                      : 0;
                    const isClosed =
                      !daySchedule?.isOpen || hour < dayStart || hour >= dayEnd;

                    const isUnavailable = isPast || isClosed;

                    return (
                      <div
                        key={`slot-${day.id}-${hour}`}
                        onClick={() => {
                          if (!isUnavailable) onEmptySlotClick(day.id, timeStr);
                        }}
                        className={`absolute w-full flex items-center justify-center border border-transparent transition-colors
                          ${isUnavailable ? "bg-slate-50/70 cursor-not-allowed opacity-100 z-0" : "opacity-0 hover:opacity-100 hover:bg-slate-50/80 cursor-pointer hover:border-brand-primary/20 z-0"}`}
                        style={{
                          top: (hour - startHour) * HOUR_HEIGHT,
                          height: HOUR_HEIGHT,
                        }}
                      >
                        {!isUnavailable && (
                          <span className="text-[10px] font-bold text-brand-primary bg-brand-light/20 px-2 py-1 rounded shadow-sm pointer-events-none">
                            + Acción
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* BLOQUEOS */}
                  {daysBlocks.map((block) => {
                    const isPast = isTimeStrInPast(day.dateObj, block.startTime);
                    const topPosition = timeToPixels(
                      block.startTime,
                      startHour,
                    );
                    const heightPixels =
                      (block.durationMins / 60) * HOUR_HEIGHT;
                    const isSmall = block.durationMins <= 45;

                    return (
                      <div
                        key={block.id}
                        onClick={() => {
                          if (!isPast) onBlockClick(block);
                        }}
                        className={`absolute left-1 right-1 sm:left-2 sm:right-2 rounded-xl border-l-4 border-y-[3px] border-r-[3px] border-white shadow-[0_3px_10px_rgba(0,0,0,0.08)] transition-all z-10 flex flex-col overflow-hidden ${isPast ? "bg-slate-100 border-slate-300 text-slate-500 opacity-60 cursor-not-allowed" : "bg-fuchsia-50 border-fuchsia-400 text-fuchsia-700 cursor-pointer hover:z-40 hover:shadow-xl hover:scale-[1.02]"}`}
                        style={{ top: topPosition, height: heightPixels }}
                        title={block.reason}
                      >
                        <div
                          className={`flex flex-col items-center justify-center h-full text-center ${isSmall ? "p-1" : "p-2"}`}
                        >
                          <Ban
                            className={`${isSmall ? "w-3 h-3 mb-0.5" : "w-4 h-4 sm:w-5 mb-1"} shrink-0`}
                          />
                          <span
                            className={`${isSmall ? "text-[8px]" : "text-[9px] sm:text-[10px]"} font-black uppercase tracking-widest leading-none wrap-break-word`}
                          >
                            {block.reason}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* CITAS MÉDICAS */}
                  {daysAppointments.map((app) => {
                    const isPast = isTimeStrInPast(day.dateObj, app.time);
                    const topPosition = timeToPixels(app.time, startHour);
                    const heightPixels = (app.durationMins / 60) * HOUR_HEIGHT;
                    const isSmall = app.durationMins <= 45;

                    return (
                      <div
                        key={app.id}
                        onClick={() => onAppointmentClick(app)}
                        className={`absolute left-1 right-1 sm:left-2 sm:right-2 rounded-xl border-l-4 border-y-[3px] border-r-[3px] border-white cursor-pointer shadow-[0_3px_10px_rgba(0,0,0,0.08)] transition-all z-20 flex flex-col overflow-hidden ${getAppointmentColors(app, isPast)} ${isPast ? "opacity-60" : "hover:z-50 hover:shadow-xl hover:scale-[1.02]"}`}
                        style={{ top: topPosition, height: heightPixels }}
                      >
                        <div
                          className={`flex flex-col h-full ${isSmall ? "p-1.5" : "p-2.5 sm:p-3"}`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <h4
                              className={`font-bold truncate leading-tight ${isSmall ? "text-[11px]" : "text-xs sm:text-sm"}`}
                            >
                              {app.patientName}
                            </h4>
                            {app.status === "pending" && <PendingBadge />}
                            {app.suppliesPending && <SuppliesPendingBadge />}
                            {!isSmall && (
                              <div className="flex items-center gap-1 text-[10px] font-bold opacity-90 bg-white/60 px-1.5 py-0.5 rounded-md shrink-0">
                                <Clock className="w-3 h-3" /> {app.time}
                              </div>
                            )}
                          </div>
                          <p
                            className={`font-medium opacity-80 truncate ${isSmall ? "text-[10px] mt-0" : "text-[10px] sm:text-xs mt-1"}`}
                          >
                            {app.service}
                          </p>
                          {isSmall && (
                            <div className="mt-auto text-[10px] font-bold opacity-90 flex items-center gap-1 pt-0.5">
                              <Clock className="w-2.5 h-2.5" /> {app.time}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
