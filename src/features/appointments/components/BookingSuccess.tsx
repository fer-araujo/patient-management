import { motion, type Variants } from "framer-motion";
import {
  CheckCircle,
  Calendar,
  Clock,
  Hourglass,
  ArrowRight,
  Plus,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";

// Un pequeño diccionario para mostrar el nombre real del servicio
const SERVICE_NAMES: Record<string, string> = {
  valoracion: "Consulta de Valoración",
  estetica: "Medicina Estética",
  regenerativa: "Medicina Regenerativa",
  "toxina-botulinica": "Toxina Botulínica (Botox)", // <-- Agregué los tuyos por si acaso
  "acido-hialuronico": "Relleno con Ácido Hialurónico",
  "hilos-tensores": "Hilos Tensores",
  prp: "Plasma Rico en Plaquetas (PRP)",
  ozonoterapia: "Sueroterapia y Ozono",
};

interface Props {
  bookingData: {
    serviceId: string;
    date: string;
    time: string;
  };
  isReschedule?: boolean; // <--- NUEVA PROP MÁGICA
  onGoToDashboard: () => void;
  onGoHome?: () => void; // La hacemos opcional porque en reprogramación no se usa
}

export const BookingSuccess = ({
  bookingData,
  isReschedule = false, // Por defecto es false
  onGoToDashboard,
  onGoHome,
}: Props) => {
  const serviceName = SERVICE_NAMES[bookingData.serviceId] || "Consulta Médica";

  // Animaciones
  const container: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.15, delayChildren: 0.2 },
    },
  };

  const item: Variants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="max-w-xl w-full mx-auto lg:mx-0 py-8 flex flex-col items-center sm:items-start text-center sm:text-left"
    >
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="w-full"
      >
        {/* ICONO GIGANTE DE ÉXITO */}
        <motion.div
          variants={item}
          className="mb-8 flex justify-center sm:justify-start"
        >
          <div className="relative">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 15,
                delay: 0.1,
              }}
              className="w-24 h-24 bg-teal-50 rounded-full flex items-center justify-center"
            >
              <CheckCircle
                className="w-12 h-12 text-teal-500"
                strokeWidth={2.5}
              />
            </motion.div>
            {/* Partículas de celebración sutiles */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="absolute -inset-4 border-2 border-dashed border-teal-200 rounded-full opacity-50 pointer-events-none"
            />
          </div>
        </motion.div>

        {/* MENSAJE PRINCIPAL DINÁMICO */}
        <motion.div variants={item}>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-brand-dark mb-4 tracking-tight">
            {isReschedule ? "¡Cita" : "¡Solicitud"}{" "}
            <br className="hidden sm:block" />
            <span className="text-teal-500">
              {isReschedule ? "Reprogramada!" : "Recibida!"}
            </span>
          </h1>
        </motion.div>

        {/* RESUMEN DE LA CITA */}
        <motion.div
          variants={item}
          className="w-full bg-white border-2 border-slate-100 rounded-4xl p-6 mb-6 shadow-sm"
        >
          <h3 className="font-bold text-brand-dark text-lg mb-4">
            {serviceName}
          </h3>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
            <div className="flex items-center gap-3 text-brand-gray font-medium">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-brand-primary">
                <Calendar className="w-5 h-5" />
              </div>
              <span>{bookingData.date}</span>
            </div>
            <div className="flex items-center gap-3 text-brand-gray font-medium">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-brand-primary">
                <Clock className="w-5 h-5" />
              </div>
              <span>{bookingData.time}</span>
            </div>
          </div>
        </motion.div>

        {/* MANEJO DE EXPECTATIVAS (SMS/WhatsApp) */}
        <motion.div
          variants={item}
          className="w-full bg-brand-light/40 border border-brand-light rounded-4xl p-6 mb-10 flex gap-4 items-start text-left"
        >
          <div className="bg-white p-2 rounded-full shadow-sm shrink-0 text-amber-500 mt-1">
            <Hourglass className="w-6 h-6" strokeWidth={2.5} />
          </div>
          <div>
            <h4 className="font-bold text-brand-dark mb-1">
              Pendiente de confirmación
            </h4>
            <p className="text-sm text-brand-gray font-medium leading-relaxed">
              La Dra. Carmen Torres revisará tu solicitud. En breve recibirás un
              mensaje confirmando tu{" "}
              {isReschedule ? "nuevo horario" : "espacio"}.
            </p>
          </div>
        </motion.div>

        {/* BOTONES DE ACCIÓN DINÁMICOS */}
        <motion.div
          variants={item}
          className="flex flex-col sm:flex-row gap-4 w-full"
        >
          <Button
            onClick={onGoToDashboard}
            // Si es reschedule, el botón ocupa todo el ancho. Si no, comparte espacio.
            className={`w-full py-4 rounded-xl text-base font-bold group cursor-pointer ${!isReschedule && "sm:flex-1"}`}
          >
            <span>Ir a mi Perfil</span>
            <div className="bg-white/20 rounded-full p-1 ml-2 transition-transform duration-300 group-hover:translate-x-1">
              <ArrowRight className="w-4 h-4" strokeWidth={3} />
            </div>
          </Button>

          {/* SÓLO SE MUESTRA SI NO ES REPROGRAMACIÓN */}
          {!isReschedule && onGoHome && (
            <Button
              onClick={onGoHome}
              variant="outline"
              className="w-full sm:w-auto px-6 py-4 rounded-xl font-bold text-base cursor-pointer hover:bg-slate-50"
            >
              <Plus className="w-5 h-5 mr-2" />
              <span>Agendar otra cita</span>
            </Button>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );
};
