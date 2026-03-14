import { Calendar, CheckCircle2, Clock, Hourglass } from "lucide-react";
import { Button } from "../../../../components/ui/Button";

interface NextAppointmentProps {
  service: string;
  doctor: string;
  date: string;
  time: string;
  status?: "pending" | "confirmed";
  onReschedule?: () => void; // <-- Nueva prop agregada
}

export const NextAppointmentCard = ({
  service,
  doctor,
  date,
  time,
  status,
  onReschedule,
}: NextAppointmentProps) => {
  const isConfirmed = status === "confirmed";

  return (
    <div className="bg-white border border-slate-200 rounded-4xl p-6 xl:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-2xl font-bold text-brand-dark">{service}</h3>
            <div className="flex items-center gap-2 mt-2 text-brand-gray font-medium">
              <div className="w-6 h-6 rounded-full bg-brand-light/50 flex items-center justify-center text-brand-primary overflow-hidden">
                <img
                  src="https://ui-avatars.com/api/?name=Carmen+Torres&background=07A996&color=fff"
                  alt="Dra"
                  className="w-full h-full object-cover"
                />
              </div>
              <span>{doctor}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-brand-dark/80 font-semibold bg-slate-50 p-3 rounded-2xl w-fit border border-slate-100">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand-primary" />
              {date}
            </div>
            <div className="w-1 h-1 rounded-full bg-slate-300 hidden sm:block"></div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-primary" />
              {time}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 min-w-40">
          {/* BADGE DE ESTADO */}
          <div
            className={`flex justify-center items-center align-middle gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider shrink-0 ${
              isConfirmed
                ? "bg-teal-50 text-teal-700 border border-teal-100"
                : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}
          >
            {isConfirmed ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Hourglass className="w-3.5 h-3.5" />
            )}
            <span>{isConfirmed ? "Confirmada" : "Pendiente"}</span>
          </div>
          <Button
            variant="outline"
            onClick={onReschedule}
            className="w-full py-3 rounded-2xl text-sm font-bold text-brand-dark/70 hover:text-brand-dark hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200"
          >
            Reprogramar
          </Button>
        </div>
      </div>
    </div>
  );
};
