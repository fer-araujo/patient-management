import { useState, useEffect } from "react";
import {
  Sparkles,
  Activity,
  Stethoscope,
  ArrowLeft,
  ChevronRight,
  Syringe,
  Droplet,
  MoveUp,
  Wind,
  Loader2,
} from "lucide-react";
import { motion, type Variants } from "framer-motion";
import {
  fetchActiveServices,
  type ClinicService,
} from "../../../lib/services/catalogService";
import toast from "react-hot-toast";

interface Props {
  isDirectMode?: boolean;
  onBack: () => void;
  onSelect: (serviceId: string) => void;
}

export const ServiceSelector = ({
  isDirectMode = false,
  onBack,
  onSelect,
}: Props) => {
  const [services, setServices] = useState<ClinicService[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadServices = async () => {
      try {
        const data = await fetchActiveServices();
        setServices(data);
      } catch (error: unknown) {
        console.error(
          "Error al cargar los tratamientos:",
          error instanceof Error ? error.message : error
        );
        toast.error("Error al cargar los tratamientos.");
      } finally {
        setIsLoading(false);
      }
    };
    loadServices();
  }, []);

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const item: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
  };

  // Mapeador Inteligente UI (Basado en el nombre o categoría, no en el UUID)
  const getVisualsForService = (name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes("toxina") || lowerName.includes("botox")) {
      return {
        icon: <Syringe className="w-5 h-5" />,
        colorClass: "text-rose-500 bg-rose-50 border-rose-100",
      };
    }
    if (lowerName.includes("hialuronico") || lowerName.includes("relleno")) {
      return {
        icon: <Droplet className="w-5 h-5" />,
        colorClass: "text-blue-500 bg-blue-50 border-blue-100",
      };
    }
    if (lowerName.includes("hilos")) {
      return {
        icon: <MoveUp className="w-5 h-5" />,
        colorClass: "text-amber-500 bg-amber-50 border-amber-100",
      };
    }
    if (lowerName.includes("prp") || lowerName.includes("plasma")) {
      return {
        icon: <Activity className="w-5 h-5" />,
        colorClass: "text-fuchsia-500 bg-fuchsia-50 border-fuchsia-100",
      };
    }
    if (lowerName.includes("ozono") || lowerName.includes("suero")) {
      return {
        icon: <Wind className="w-5 h-5" />,
        colorClass: "text-cyan-500 bg-cyan-50 border-cyan-100",
      };
    }
    // Default
    return {
      icon: <Sparkles className="w-5 h-5" />,
      colorClass: "text-brand-primary bg-brand-light/30 border-brand-light/50",
    };
  };

  // Buscamos la "Consulta de Valoración" por nombre
  const valoracionService = services.find(
    (s) =>
      s.name.toLowerCase().includes("valoración") ||
      s.name.toLowerCase().includes("valoracion"),
  );
  const otherServices = services.filter((s) => s.id !== valoracionService?.id);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.4 }}
      className="max-w-3xl w-full mx-auto py-4"
    >
      <div className="flex items-center gap-4 mb-8">
        {isDirectMode ? (
          <>
            <button
              onClick={onBack}
              className="w-10 h-10 cursor-pointer rounded-full bg-brand-light/40 flex items-center justify-center text-brand-primary hover:bg-brand-light/70 transition-colors shrink-0"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
            </button>
            <div className="inline-flex items-center gap-2.5 px-3 py-1.5 bg-brand-light/50 rounded-full border border-brand-light">
              <p className="text-[11px] font-bold text-brand-dark tracking-wider uppercase">
                Volver
              </p>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      <h2 className="text-4xl sm:text-5xl font-bold text-brand-dark mb-4 leading-tight tracking-tight">
        ¿En qué te podemos <br /> ayudar hoy?
      </h2>

      <p className="text-lg text-brand-gray/80 font-medium mb-10 max-w-md">
        Elige el tipo de consulta que necesitas para mostrarte los horarios
        disponibles de la Dra. Carmen Torres.
      </p>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
          <p className="text-brand-gray font-medium">
            Cargando catálogo de servicios...
          </p>
        </div>
      ) : (
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="space-y-8"
        >
          {valoracionService && (
            <motion.div variants={item}>
              <h3 className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-3 ml-2">
                Si es tu primera vez
              </h3>
              <button
                onClick={() => onSelect(valoracionService.id)}
                className="w-full cursor-pointer text-left bg-linear-to-br from-white to-brand-light/20 border-2 border-brand-light/60 rounded-3xl p-5 sm:p-6 hover:border-brand-primary hover:shadow-xl hover:shadow-brand-primary/10 transition-all group flex items-center justify-between"
              >
                <div className="flex items-center gap-5 sm:gap-6 pr-4">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 border border-blue-100 bg-blue-50 text-blue-600 transition-transform group-hover:scale-110 shadow-sm">
                    <Stethoscope className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-brand-dark mb-1 group-hover:text-brand-primary transition-colors">
                      {valoracionService.name}
                    </h3>
                    <p className="text-sm text-brand-gray font-medium leading-relaxed">
                      {valoracionService.description ||
                        "Revisión general y diagnóstico."}
                    </p>
                  </div>
                </div>

                <div className="w-10 h-10 rounded-full bg-white border border-slate-100 shadow-sm flex items-center justify-center text-brand-gray/40 group-hover:bg-brand-primary group-hover:border-brand-primary group-hover:text-white transition-all shrink-0">
                  <ChevronRight className="w-6 h-6" />
                </div>
              </button>
            </motion.div>
          )}

          <motion.div variants={item}>
            <h3 className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-3 ml-2">
              Tratamientos Específicos
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {otherServices.map((service) => {
                const visuals = getVisualsForService(service.name);
                return (
                  <button
                    key={service.id}
                    onClick={() => onSelect(service.id)}
                    className="w-full cursor-pointer text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-brand-primary hover:shadow-md hover:shadow-brand-primary/10 transition-all group flex items-start gap-4"
                  >
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 ${visuals.colorClass}`}
                    >
                      {visuals.icon}
                    </div>
                    <div className="flex-1 pr-2 mt-0.5">
                      <h4 className="text-base font-bold text-brand-dark mb-1 group-hover:text-brand-primary transition-colors leading-tight">
                        {service.name}
                      </h4>
                      <p className="text-xs text-brand-gray font-medium leading-snug line-clamp-2">
                        {service.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
};
