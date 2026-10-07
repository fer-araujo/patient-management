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

interface DailyViewProps {
  appointments: DashboardAppointment[];
  blockedSlots: DashboardBlockedSlot[];
  onEmptySlotClick: (d: string, t: string) => void;
  onAppointmentClick: (a: DashboardAppointment) => void;
  onBlockClick: (b: DashboardBlockedSlot) => void;
}

export const DailyView = ({
  appointments,
  blockedSlots,
  onEmptySlotClick,
  onAppointmentClick,
  onBlockClick,
}: DailyViewProps) => {
  const { baseDate, workingSchedule } = useCalendar();

  const { start: startHour, end: endHour } = getGridHoursRange(workingSchedule);
  const HOURS = Array.from(
    { length: endHour - startHour + 1 },
    (_, i) => startHour + i,
  );

  const viewDateStr = baseDate
    .toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .replace(/\./g, "");
  const daysAppointments = appointments.filter(
    (app) => app.date.toLowerCase() === viewDateStr.toLowerCase(),
  );
  const daysBlocks = blockedSlots.filter(
    (b) => b.date.toLowerCase() === viewDateStr.toLowerCase(),
  );

  const dayName = baseDate.toLocaleDateString("es-MX", { weekday: "long" });
  const dayNumberAndMonth = baseDate
    .toLocaleDateString("es-MX", { day: "2-digit", month: "long" })
    .replace("-", " ");

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col h-187.5 max-xl:h-[70vh] max-xl:supports-[height:1dvh]:h-[70dvh] max-xl:min-h-105">
      <div className="flex border-b border-slate-200 bg-slate-50/80 sticky top-0 z-20">
        <div className="w-16 sm:w-20 shrink-0 border-r border-slate-200"></div>
        <div className="flex-1 py-4 text-center">
          <span className="text-xs font-black text-brand-primary uppercase tracking-widest">
            {dayName}
          </span>
          <h3 className="text-xl font-bold text-brand-dark leading-none mt-1 capitalize">
            {dayNumberAndMonth}
          </h3>
        </div>
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
                <span className="text-[11px] sm:text-xs font-bold text-slate-400 absolute -top-3 bg-white px-1">
                  {String(hour > 12 ? hour - 12 : hour).padStart(2, "0")}:00{" "}
                  {hour >= 12 ? "PM" : "AM"}
                </span>
              </div>
            ))}
          </div>

          <div className="flex-1 flex relative">
            <div className="absolute inset-0 pointer-events-none">
              {HOURS.map((h) => (
                <div
                  key={`line-${h}`}
                  className="w-full border-t border-slate-100"
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}
            </div>

            <div className="flex-1 relative group/col">
              {/* SLOTS VACÍOS Y BLOQUEO POR DÍA CERRADO */}
              {HOURS.slice(0, -1).map((hour) => {
                const timeStr = `${String(hour > 12 ? hour - 12 : hour).padStart(2, "0")}:00 ${hour >= 12 ? "PM" : "AM"}`;
                const isPast = isTimeSlotInPast(baseDate, hour);

                // Evaluar si la clínica está cerrada en baseDate
                const daySchedule =
                  workingSchedule[baseDate.getDay() as keyof WeeklySchedule];
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
                    key={`slot-${hour}`}
                    onClick={() => {
                      if (!isUnavailable)
                        onEmptySlotClick(viewDateStr, timeStr);
                    }}
                    className={`absolute w-full flex items-center justify-center border border-transparent transition-colors
                      ${isUnavailable ? "bg-slate-50/70 cursor-not-allowed opacity-100 z-0" : "opacity-0 hover:opacity-100 pointer-coarse:opacity-100 hover:bg-slate-50/50 cursor-pointer hover:border-brand-primary/20 z-0"}`}
                    style={{
                      top: (hour - startHour) * HOUR_HEIGHT,
                      height: HOUR_HEIGHT,
                    }}
                  >
                    {!isUnavailable && (
                      <>
                        {/* Mouse: full label on hover. Touch has no hover,
                            so a faint "+" marks every free hour. */}
                        <span className="text-sm font-bold text-brand-primary bg-brand-light/20 px-4 py-2 rounded-lg shadow-sm pointer-events-none pointer-coarse:hidden">
                          + Agendar o Bloquear {timeStr}
                        </span>
                        <span
                          aria-hidden="true"
                          className="hidden pointer-coarse:inline text-2xl font-bold text-brand-primary/30 pointer-events-none"
                        >
                          +
                        </span>
                      </>
                    )}
                  </div>
                );
              })}

              {/* BLOQUEOS DE AGENDA */}
              {daysBlocks.map((block) => {
                const isPast = isTimeStrInPast(baseDate, block.startTime);
                const topPosition = timeToPixels(block.startTime, startHour);
                const heightPixels = (block.durationMins / 60) * HOUR_HEIGHT;
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
                const isPast = isTimeStrInPast(baseDate, app.time);
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
                          className={`font-bold truncate leading-tight ${isSmall ? "text-[10px]" : "text-xs sm:text-sm"}`}
                        >
                          {app.patientName}
                        </h4>
                        {app.status === "pending" && (
                          <PendingBadge overdue={isPast} />
                        )}
                        {app.suppliesPending && <SuppliesPendingBadge />}
                        {!isSmall && (
                          <div className="flex items-center gap-1 text-[10px] font-bold opacity-90 bg-white/60 px-1.5 py-0.5 rounded-md shrink-0">
                            <Clock className="w-3 h-3" /> {app.time}
                          </div>
                        )}
                      </div>
                      <p
                        className={`font-medium opacity-80 truncate ${isSmall ? "text-[9px] mt-0" : "text-[10px] sm:text-xs mt-1"}`}
                      >
                        {app.service}
                      </p>
                      {isSmall && (
                        <div className="mt-auto text-[9px] font-bold opacity-90 flex items-center gap-1 pt-0.5">
                          <Clock className="w-2.5 h-2.5" /> {app.time}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
