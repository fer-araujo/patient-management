import { type AppointmentData } from "../../../../../data/mockPatients";

const DAYS_OF_WEEK = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MARCH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

interface MonthlyViewProps {
  appointments: AppointmentData[];
  onAppointmentClick: (appointment: AppointmentData) => void;
  onEmptySlotClick: (date: string, time: string) => void; // <-- Agregado
}

export const MonthlyView = ({
  appointments,
  onAppointmentClick,
  onEmptySlotClick,
}: MonthlyViewProps) => {
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
        {MARCH_DAYS.map((day) => {
          const dateStr = `${day.toString().padStart(2, "0")} Mar 2026`;
          const daysApps = appointments.filter((a) => a.date === dateStr);

          return (
            <div
              key={day}
              onClick={() => onEmptySlotClick(dateStr, "09:00 AM")} // Al hacer click en el día, asume 9AM y abre el modal
              className="bg-white p-2 sm:p-3 flex flex-col hover:bg-slate-50 cursor-pointer transition-colors relative group"
            >
              {/* Indicador de Hover para agendar */}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px] font-bold text-brand-primary bg-brand-light/30 px-2 py-1 rounded">
                  + Acción
                </span>
              </div>

              <span
                className={`text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full mb-2 ${day === 16 ? "bg-brand-primary text-white shadow-sm" : "text-brand-dark"}`}
              >
                {day}
              </span>

              <div className="flex-1 space-y-1 overflow-hidden">
                {daysApps.map((app, idx) => {
                  if (idx > 2) return null;
                  return (
                    <div
                      key={app.id}
                      onClick={(e) => {
                        e.stopPropagation(); // Evita que se abra el modal de "Agendar" y abre el detalle
                        onAppointmentClick(app);
                      }}
                      className="text-[10px] font-bold bg-brand-light/30 hover:bg-brand-light text-brand-primary px-1.5 py-1 rounded truncate transition-colors cursor-pointer"
                    >
                      {app.time} - {app.patientName.split(" ")[0]}
                    </div>
                  );
                })}
                {daysApps.length > 3 && (
                  <p className="text-[10px] font-medium text-brand-gray pl-1">
                    +{daysApps.length - 3} más
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="bg-slate-50/50 pointer-events-none"
          ></div>
        ))}
      </div>
    </div>
  );
};
