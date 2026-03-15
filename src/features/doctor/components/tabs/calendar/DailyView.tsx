import { Clock, MoreHorizontal } from "lucide-react";
import { type AppointmentData } from "../../../../../data/mockPatients";

const START_HOUR = 8;
const END_HOUR = 18;
const HOUR_HEIGHT = 100;
const APPOINTMENT_DURATION = 45;
const HOURS = Array.from(
  { length: END_HOUR - START_HOUR + 1 },
  (_, i) => START_HOUR + i,
);

const timeToPixels = (timeStr: string) => {
  const [time, modifier] = timeStr.split(" ");
  // eslint-disable-next-line prefer-const
  let [hours, minutes] = time.split(":").map(Number);
  if (modifier === "PM" && hours !== 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;
  const offsetMinutes = hours * 60 + minutes - START_HOUR * 60;
  return (offsetMinutes / 60) * HOUR_HEIGHT;
};

const getServiceColors = (service: string) => {
  if (service.includes("Toxina"))
    return "bg-blue-50 border-blue-500 text-blue-700";
  if (service.includes("Hilos"))
    return "bg-emerald-50 border-emerald-500 text-emerald-700";
  if (service.includes("Plasma"))
    return "bg-rose-50 border-rose-400 text-rose-700";
  if (service.includes("Valoración"))
    return "bg-slate-100 border-slate-400 text-slate-700";
  return "bg-amber-50 border-amber-400 text-amber-700";
};

interface DailyViewProps {
  appointments: AppointmentData[];
  onAppointmentClick: (appointment: AppointmentData) => void;
  onEmptySlotClick: (date: string, time: string) => void;
}

export const DailyView = ({
  appointments,
  onAppointmentClick,
  onEmptySlotClick,
}: DailyViewProps) => {
  // Hardcodeamos el lunes para la demostración de la vista diaria
  const today = "16 Mar 2026";
  const daysAppointments = appointments.filter((app) => app.date === today);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col h-187.5">
      <div className="flex border-b border-slate-200 bg-slate-50/80 sticky top-0 z-20">
        <div className="w-16 sm:w-20 shrink-0 border-r border-slate-200"></div>
        <div className="flex-1 py-4 text-center">
          <span className="text-xs font-black text-brand-primary uppercase tracking-widest">
            Lunes
          </span>
          <h3 className="text-xl font-bold text-brand-dark leading-none mt-1">
            16 de Marzo
          </h3>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto relative bg-white [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-50/50 [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300 transition-colors">
        <div className="flex w-full relative min-h-max">
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
              {HOURS.map((hour) => (
                <div
                  key={`line-${hour}`}
                  className="w-full border-t border-slate-100"
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}
            </div>

            <div className="flex-1 relative group/col">
              {HOURS.slice(0, -1).map((hour) => {
                const timeStr = `${String(hour > 12 ? hour - 12 : hour).padStart(2, "0")}:00 ${hour >= 12 ? "PM" : "AM"}`;
                return (
                  <div
                    key={`slot-${hour}`}
                    onClick={() => onEmptySlotClick(today, timeStr)}
                    className="absolute w-full opacity-0 hover:opacity-100 hover:bg-slate-50/50 cursor-pointer transition-colors z-0 flex items-center justify-center border border-transparent hover:border-brand-primary/20"
                    style={{
                      top: (hour - START_HOUR) * HOUR_HEIGHT,
                      height: HOUR_HEIGHT,
                    }}
                  >
                    <span className="text-sm font-bold text-brand-primary bg-brand-light/20 px-4 py-2 rounded-lg shadow-sm pointer-events-none">
                      + Agendar o Bloquear {timeStr}
                    </span>
                  </div>
                );
              })}

              {daysAppointments.map((app) => {
                const topPosition = timeToPixels(app.time);
                const heightPixels = (APPOINTMENT_DURATION / 60) * HOUR_HEIGHT;
                return (
                  <div
                    key={app.id}
                    onClick={() => onAppointmentClick(app)}
                    className={`absolute left-4 right-4 rounded-xl border-l-4 p-4 cursor-pointer shadow-sm hover:shadow-md transition-all z-20 flex flex-col group overflow-hidden ${getServiceColors(app.service)}`}
                    style={{ top: topPosition, height: heightPixels }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold truncate">
                          {app.patientName}
                        </h4>
                        <p className="text-xs font-medium opacity-80 mt-1">
                          {app.service}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <MoreHorizontal className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="flex items-center gap-1.5 text-xs font-bold opacity-90 bg-white/50 px-2 py-1 rounded-md">
                          <Clock className="w-3.5 h-3.5" /> {app.time}
                        </div>
                      </div>
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
