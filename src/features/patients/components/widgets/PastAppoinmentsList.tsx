import { useState } from "react";
import { ChevronRight, Calendar, User, Syringe, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";

export interface PastAppointment {
  id: number;
  date: string;
  service: string;
  doctor: string;
}

export const PastAppointmentsList = ({
  appointments,
}: {
  appointments: PastAppointment[];
}) => {
  const navigate = useNavigate();
  const [selectedAppointment, setSelectedAppointment] = useState<PastAppointment | null>(null);

  return (
    <>
      <div className="space-y-4">
        {appointments.map((appt) => (
          <div
            key={appt.id}
            onClick={() => setSelectedAppointment(appt)}
            className="group cursor-pointer"
          >
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

      {/* MODAL DE DETALLE CON BOTONES UNIFICADOS Y TEXTO BASE */}
      <Modal
        isOpen={selectedAppointment !== null}
        onClose={() => setSelectedAppointment(null)}
        title="Detalle de Cita"
        icon={<Calendar className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
      >
        {selectedAppointment && (
          <div className="flex flex-col px-2 pb-2">
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 mb-6 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-brand-light/30 rounded-full blur-xl pointer-events-none"></div>

              <div className="relative z-10 flex flex-col gap-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-brand-primary shadow-sm shrink-0">
                    <Syringe className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-brand-gray uppercase tracking-wider mb-0.5">
                      Tratamiento
                    </p>
                    <p className="font-bold text-brand-dark text-lg leading-tight">
                      {selectedAppointment.service}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-brand-primary shadow-sm shrink-0">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-brand-gray uppercase tracking-wider mb-0.5">
                      Fecha
                    </p>
                    <p className="font-bold text-brand-dark">
                      {selectedAppointment.date}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-brand-primary shadow-sm shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-brand-gray uppercase tracking-wider mb-0.5">
                      Atendido por
                    </p>
                    <p className="font-bold text-brand-dark">
                      {selectedAppointment.doctor}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* BOTONES CON TEXT-BASE Y FONT-BOLD */}
            <div className="flex flex-col sm:flex-row gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setSelectedAppointment(null)}
                className="w-full sm:w-1/3 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-brand-gray hover:text-brand-dark text-base font-bold cursor-pointer"
              >
                Cerrar
              </Button>
              <Button
                onClick={() =>
                  navigate("/dashboard/agendar", {
                    state: { preselectedService: "toxina-botulinica" }, // <-- En prod usamos selectedAppointment.serviceId
                  })
                }
                className="w-full sm:w-2/5 py-3 rounded-xl shadow-md group cursor-pointer text-base font-bold"
              >
                Agendar de nuevo
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};