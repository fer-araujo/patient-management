import { Clock, MoreHorizontal } from "lucide-react";
import { type AppointmentData } from "../../../../../data/mockPatients";

// Configuraciones
const START_HOUR = 8;
const END_HOUR = 18;
const HOUR_HEIGHT = 100;
const APPOINTMENT_DURATION = 45;

const HOURS = Array.from(
  { length: END_HOUR - START_HOUR + 1 },
  (_, i) => START_HOUR + i,
);

const WEEK_DAYS = [
  { id: "16 Mar 2026", name: "LUN 16" },
  { id: "17 Mar 2026", name: "MAR 17" },
  { id: "18 Mar 2026", name: "MIÉ 18" },
  { id: "19 Mar 2026", name: "JUE 19" },
  { id: "20 Mar 2026", name: "VIE 20" },
];

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

interface WeeklyViewProps {
  appointments: AppointmentData[];
  onAppointmentClick: (appointment: AppointmentData) => void;
  onEmptySlotClick: (date: string, time: string) => void;
}

export const WeeklyView = ({
  appointments,
  onAppointmentClick,
  onEmptySlotClick,
}: WeeklyViewProps) => {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col h-187.5">
      {/* Encabezados de los días */}
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

      {/* Contenedor scrolleable del calendario */}
      <div className="flex-1 overflow-y-auto relative bg-white [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-50/50 [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300 transition-colors">
        <div className="flex w-full relative min-h-max">
          {/* Eje Y: Las Horas */}
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

          {/* Eje X: Los Días (Columnas) */}
          <div className="flex-1 flex relative">
            {/* Grid Lineas */}
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
                (app) => app.date === day.id,
              );

              return (
                <div
                  key={day.id}
                  className="flex-1 relative border-r border-slate-100 last:border-r-0 group/col"
                >
                  {/* Slots Vacíos */}
                  {HOURS.slice(0, -1).map((hour) => {
                    const timeStr = `${String(hour > 12 ? hour - 12 : hour).padStart(2, "0")}:00 ${hour >= 12 ? "PM" : "AM"}`;
                    return (
                      <div
                        key={`slot-${day.id}-${hour}`}
                        onClick={() => onEmptySlotClick(day.id, timeStr)}
                        className="absolute w-full opacity-0 hover:opacity-100 hover:bg-slate-50/50 cursor-pointer transition-colors z-0 flex items-center justify-center border border-transparent hover:border-brand-primary/20"
                        style={{
                          top: (hour - START_HOUR) * HOUR_HEIGHT,
                          height: HOUR_HEIGHT,
                        }}
                      >
                        <span className="text-[10px] font-bold text-brand-primary bg-brand-light/20 px-2 py-1 rounded shadow-sm pointer-events-none">
                          + Acción
                        </span>
                      </div>
                    );
                  })}

                  {/* Citas */}
                  {daysAppointments.map((app) => {
                    const topPosition = timeToPixels(app.time);
                    const heightPixels =
                      (APPOINTMENT_DURATION / 60) * HOUR_HEIGHT;
                    return (
                      <div
                        key={app.id}
                        onClick={() => onAppointmentClick(app)}
                        className={`absolute left-1 right-1 rounded-lg border-l-4 p-2 sm:p-2.5 cursor-pointer shadow-sm hover:shadow-md transition-all z-20 flex flex-col group overflow-hidden ${getServiceColors(app.service)}`}
                        style={{ top: topPosition, height: heightPixels }}
                      >
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <h4 className="text-[11px] sm:text-xs font-bold truncate leading-tight">
                            {app.patientName}
                          </h4>
                          <MoreHorizontal className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                        <p className="text-[9px] sm:text-[10px] font-medium opacity-80 truncate hidden sm:block">
                          {app.service}
                        </p>
                        <div className="mt-auto flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold opacity-90">
                          <Clock className="w-3 h-3 hidden sm:block" />{" "}
                          {app.time}
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
