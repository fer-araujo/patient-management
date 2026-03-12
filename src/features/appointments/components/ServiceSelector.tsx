import {
  Sparkles,
  Activity,
  Stethoscope,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import { motion, type Variants } from "framer-motion";

interface Service {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const SERVICES: Service[] = [
  {
    id: "valoracion",
    title: "Consulta de Valoración",
    description:
      "Primera vez o revisión general para armar un plan a tu medida.",
    icon: <Stethoscope className="w-8 h-8" />,
    color: "bg-blue-50 text-blue-600 border-blue-100",
  },
  {
    id: "estetica",
    title: "Medicina Estética",
    description:
      "Aplicación de Botox, Ácido Hialurónico, bioestimuladores y armonización.",
    icon: <Sparkles className="w-8 h-8" />,
    color: "bg-rose-50 text-rose-500 border-rose-100",
  },
  {
    id: "regenerativa",
    title: "Medicina Regenerativa",
    description:
      "Ozonoterapia, sueros intravenosos, plasma rico en plaquetas (PRP).",
    icon: <Activity className="w-8 h-8" />,
    color: "bg-teal-50 text-teal-600 border-teal-100",
  },
];

interface Props {
  onBack: () => void;
  onSelect: (serviceId: string) => void;
}

export const ServiceSelector = ({ onBack, onSelect }: Props) => {
  // Tipado correcto para evitar errores de TS
  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const item: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.4 }}
      className="max-w-xl w-full mx-auto lg:mx-0 py-4"
    >
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="w-10 h-10 cursor-pointer rounded-full bg-brand-light/40 flex items-center justify-center text-brand-primary hover:bg-brand-light/70 transition-colors shrink-0"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
        </button>
        <div className="inline-flex items-center gap-2.5 px-3 py-1.5 bg-brand-light/50 rounded-full border border-brand-light">
          <p className="text-[11px] font-bold text-brand-dark tracking-wider uppercase">
            Paso 1 de 2: Servicio
          </p>
        </div>
      </div>

      <h2 className="text-4xl sm:text-5xl font-bold text-brand-dark mb-4 leading-tight tracking-tight">
        ¿En qué te podemos <br /> ayudar hoy?
      </h2>

      <p className="text-lg text-brand-gray/80 font-medium mb-10 max-w-md">
        Elige el tipo de consulta que necesitas para mostrarte los horarios
        disponibles de la Dra. Carmen Torres.
      </p>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="space-y-4"
      >
        {SERVICES.map((service) => (
          <motion.button
            key={service.id}
            variants={item}
            onClick={() => onSelect(service.id)}
            className="w-full cursor-pointer text-left bg-white border-2 border-brand-light/50 rounded-3xl p-5 sm:p-6 hover:border-brand-primary hover:shadow-lg hover:shadow-brand-primary/10 transition-all group flex items-center justify-between"
          >
            <div className="flex items-center gap-5 sm:gap-6 pr-4">
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 border transition-transform group-hover:scale-110 ${service.color}`}
              >
                {service.icon}
              </div>
              <div>
                <h3 className="text-xl font-bold text-brand-dark mb-1 group-hover:text-brand-primary transition-colors">
                  {service.title}
                </h3>
                <p className="text-sm text-brand-gray font-medium leading-relaxed">
                  {service.description}
                </p>
              </div>
            </div>

            <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-brand-gray/40 group-hover:bg-brand-light/50 group-hover:text-brand-primary transition-colors shrink-0">
              <ChevronRight className="w-6 h-6" />
            </div>
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  );
};
