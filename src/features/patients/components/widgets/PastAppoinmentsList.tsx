import { ChevronRight } from "lucide-react";

interface PastAppointment {
  id: number;
  date: string;
  service: string;
  doctor: string;
}

export const PastAppointmentsList = ({
  appointments,
}: {
  appointments: PastAppointment[];
}) => (
  <div className="space-y-4">
    {appointments.map((appt) => (
      <div key={appt.id} className="group cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-50 flex flex-col items-center justify-center border border-slate-100 group-hover:bg-brand-light/50 transition-colors">
              <span className="text-[10px] font-bold text-brand-gray uppercase">
                {appt.date.split(" ")[1]}
              </span>
              <span className="text-sm font-black text-brand-dark leading-none">
                {appt.date.split(" ")[0]}
              </span>
            </div>
            <div>
              <p className="text-sm font-bold text-brand-dark">
                {appt.service}
              </p>
              <p className="text-xs text-brand-gray font-medium">
                {appt.doctor}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-brand-gray/40 group-hover:text-brand-primary transition-colors" />
        </div>
        <div className="h-px w-full bg-slate-50 mt-4 group-last:hidden"></div>
      </div>
    ))}
  </div>
);
