import { useState } from "react";
import { HeartPulse, ChevronDown, ArrowRight, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";

interface Props {
  onSubmit: (code: string, number: string) => void;
}

export const PatientPhoneLogin = ({ onSubmit }: Props) => {
  const [countryCode, setCountryCode] = useState("+52");
  const [phoneNumber, setPhoneNumber] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(countryCode, phoneNumber);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.4 }}
      className="max-w-lg w-full mx-auto lg:mx-0"
    >
      <div className="inline-flex items-center gap-3 px-4 py-2 bg-brand-light/50 rounded-full border border-brand-light mb-8 xl:mb-12">
        <div className="bg-white p-1.5 rounded-full shadow-sm text-brand-primary">
          <HeartPulse className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-sm font-bold text-brand-dark tracking-wide">
            Dra. Carmen Torres
          </p>
        </div>
      </div>

      <h1 className="text-5xl sm:text-6xl lg:text-5xl xl:text-[4rem] font-bold text-brand-dark mb-6 leading-[1.05] tracking-tight">
        Cuidado médico <br />
        que <span className="text-brand-primary">realmente</span> <br />
        te escucha.
      </h1>

      <p className="text-lg xl:text-xl text-brand-gray/80 leading-relaxed font-medium mb-10 xl:mb-12 max-w-sm">
        Agende su consulta de forma rápida y segura. Sin contraseñas
        complicadas.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6 xl:space-y-8">
        <div className="flex gap-3 sm:gap-4 items-end">
          {/* CAMBIO AQUÍ: Ajustes responsivos para que no se coma el texto */}
          <div className="relative w-28 sm:w-1/3 shrink-0">
            <label className="text-brand-dark font-medium text-base xl:text-lg block mb-2 ml-1">
              País
            </label>
            <div className="relative group">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-full appearance-none pl-3 pr-8 sm:px-4 py-3 xl:py-4 bg-white border-2 border-brand-light rounded-2xl text-base xl:text-lg font-semibold text-brand-dark focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all cursor-pointer group-hover:border-brand-primary/50"
              >
                <option value="+52">MX +52</option>
                <option value="+1">US +1</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 sm:pr-4 text-brand-gray">
                <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
            </div>
          </div>

          <Input
            label="Número celular"
            type="tel"
            placeholder="55 1234 5678"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            required
            containerClassName="w-full"
          />
        </div>

        <div className="pt-2 xl:pt-4">
          <Button
            type="submit"
            className="group w-fit px-8 xl:px-10 rounded-full text-base xl:text-lg"
          >
            <span>Agendar Cita</span>
            <div className="bg-white/20 rounded-full p-1.5 ml-2 transition-transform duration-300 ease-out group-hover:translate-x-1.5">
              <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
            </div>
          </Button>
        </div>
      </form>

      <div className="mt-12 xl:mt-16 pt-6 border-t border-brand-light flex items-center gap-3 relative z-20">
        <ShieldCheck className="w-5 h-5 text-brand-primary shrink-0" />
        <p className="text-sm font-medium text-brand-gray">
          Su privacidad es nuestra prioridad.{" "}
          <br className="hidden sm:block lg:hidden" /> Conexión segura y
          encriptada.
        </p>
      </div>
    </motion.div>
  );
};
