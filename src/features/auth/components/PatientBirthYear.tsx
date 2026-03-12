import { useState } from "react";
import { HeartPulse, ArrowLeft, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";

interface Props {
  onBack: () => void;
  onSubmit: (year: string) => void;
}

export const PatientBirthYear = ({ onBack, onSubmit }: Props) => {
  const [birthYear, setBirthYear] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(birthYear);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.4 }}
      className="max-w-lg w-full mx-auto lg:mx-0"
    >
      <div className="flex items-center gap-4 mb-8 xl:mb-12">
        <button
          onClick={onBack}
          className="w-10 h-10 cursor-pointer rounded-full bg-brand-light/40 flex items-center justify-center text-brand-primary hover:bg-brand-light/70 transition-colors"
          aria-label="Volver atrás"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
        </button>
        <div className="inline-flex items-center gap-3 px-4 py-2 bg-brand-light/50 rounded-full border border-brand-light">
          <div className="bg-white p-1 rounded-full shadow-sm text-brand-primary">
            <HeartPulse className="w-4 h-4" strokeWidth={2.5} />
          </div>
          {/* CAMBIO AQUÍ: Ya no dice Paso 2 de 2 */}
          <p className="text-xs font-bold text-brand-dark tracking-wide uppercase">
            Verificación
          </p>
        </div>
      </div>

      <h1 className="text-5xl sm:text-6xl lg:text-5xl xl:text-[4rem] font-bold text-brand-dark mb-6 leading-[1.05] tracking-tight">
        Solo un paso <br />
        <span className="text-brand-primary">más.</span>
      </h1>

      <p className="text-lg xl:text-xl text-brand-gray/80 leading-relaxed font-medium mb-10 xl:mb-12 max-w-sm">
        Para garantizar la seguridad de su expediente clínico, por favor
        confirme su año de nacimiento.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6 xl:space-y-8 max-w-sm">
        <div className="flex flex-col gap-2">
          <Input
            label="Año de nacimiento"
            type="tel"
            placeholder="Ej. 1968"
            value={birthYear}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              if (val.length <= 4) setBirthYear(val);
            }}
            required
            containerClassName="w-full"
            className="text-center text-3xl tracking-[0.15em] font-bold py-3 xl:py-4 placeholder:tracking-normal placeholder:text-lg placeholder:font-medium placeholder:text-brand-gray/50"
          />
        </div>

        <div className="pt-2 xl:pt-4">
          <Button
            type="submit"
            disabled={birthYear.length !== 4}
            className="group w-full xl:w-fit xl:px-12 rounded-full text-base xl:text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <span>Verificar Identidad</span>
            <div className="bg-white/20 rounded-full p-1.5 ml-2 transition-transform duration-300 ease-out group-hover:translate-x-1.5">
              <ShieldCheck className="w-5 h-5" strokeWidth={2.5} />
            </div>
          </Button>
        </div>
      </form>
    </motion.div>
  );
};
