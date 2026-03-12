import { useRef } from "react";
import { Upload, FileText } from "lucide-react";
import { motion, type Variants } from "framer-motion";
import { NextAppointmentCard } from "./widgets/NextAppoinmentCard";
import { CarePlanWidget } from "./widgets/CarePlanWidget";
import { PastAppointmentsList } from "./widgets/PastAppoinmentsList";

// Importaciones de los widgets extraídos

const MOCK_PATIENT = {
  name: "María",
  fullName: "María López",
  age: 56,
  nextAppointment: {
    date: "Lunes, 16 de Marzo",
    time: "11:00 AM - 11:45 AM",
    service: "Consulta Anti-Aging & Ozono",
    doctor: "Dra. Carmen Torres",
    location: "Consultorio Principal",
  },
  carePlan: [
    {
      id: 1,
      type: "med",
      name: "Colágeno Hidrolizado",
      instruction: "1 scoop en ayunas",
      daysLeft: "Continuo",
    },
    {
      id: 2,
      type: "care",
      name: "Protector Solar FPS 50+",
      instruction: "Reaplicar cada 4 horas",
      daysLeft: "Diario",
    },
  ],
  pastAppointments: [
    {
      id: 1,
      date: "12 Feb 2026",
      service: "Aplicación de Botox",
      doctor: "Dra. Carmen T.",
    },
    {
      id: 2,
      date: "05 Ene 2026",
      service: "Valoración Inicial",
      doctor: "Dra. Carmen T.",
    },
  ],
};

export const PatientDashboard = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log("Archivo listo para subir:", file.name);
      alert(`¡Listo! El archivo ${file.name} se enviará a la doctora.`);
    }
  };

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const item: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 xl:pt-10">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14"
      >
        {/* ========================================================
            COLUMNA IZQUIERDA (70%)
            ======================================================== */}
        <div className="lg:col-span-8 space-y-8">
          <motion.div variants={item}>
            <h1 className="text-3xl xl:text-4xl font-extrabold text-brand-dark tracking-tight mb-1">
              Hola, {MOCK_PATIENT.name}.
            </h1>
            <p className="text-lg text-brand-gray font-medium">
              Tienes{" "}
              <span className="text-brand-primary font-bold">1 cita</span>{" "}
              programada para esta semana.
            </p>
          </motion.div>

          {/* QUICK ACTIONS (Pills Pastel) */}
          <motion.div
            variants={item}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <div
              onClick={() => fileInputRef.current?.click()}
              className="bg-teal-50/80 hover:bg-teal-50 border border-teal-100 rounded-3xl p-5 cursor-pointer group transition-all"
            >
              <input
                type="file"
                accept="image/*, application/pdf"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-teal-900 mb-0.5">
                    Subir Estudios
                  </h3>
                  <p className="text-sm text-teal-700/80 font-medium">
                    Labs o Radiografías
                  </p>
                </div>
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-teal-600 shadow-sm group-hover:scale-105 transition-transform">
                  <Upload className="w-5 h-5" />
                </div>
              </div>
            </div>

            <div className="bg-rose-50/80 hover:bg-rose-50 border border-rose-100 rounded-3xl p-5 cursor-pointer group transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-rose-900 mb-0.5">
                    Mis Recetas
                  </h3>
                  <p className="text-sm text-rose-700/80 font-medium">
                    1 receta disponible
                  </p>
                </div>
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-rose-500 shadow-sm group-hover:scale-105 transition-transform">
                  <FileText className="w-5 h-5" />
                </div>
              </div>
            </div>
          </motion.div>

          {/* WIDGET: PRÓXIMA CITA */}
          <motion.div variants={item}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-brand-dark">
                Próxima Cita
              </h2>
              <button className="text-sm font-bold text-brand-primary hover:text-brand-dark transition-colors">
                Ver calendario
              </button>
            </div>
            <NextAppointmentCard {...MOCK_PATIENT.nextAppointment} />
          </motion.div>

          {/* WIDGET: PLAN DE CUIDADO */}
          <motion.div variants={item}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-brand-dark">
                Mi Plan de Cuidado
              </h2>
            </div>
            <CarePlanWidget plan={MOCK_PATIENT.carePlan} />
          </motion.div>
        </div>

        {/* ========================================================
            COLUMNA DERECHA (30%)
            ======================================================== */}
        <div className="lg:col-span-4 space-y-6">
          {/* PERFIL */}
          <motion.div
            variants={item}
            className="bg-white border border-slate-200 rounded-4xl p-6 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          >
            <div className="w-24 h-24 mx-auto rounded-full bg-brand-light flex items-center justify-center text-brand-primary text-3xl font-black mb-4 border-4 border-white shadow-md">
              {MOCK_PATIENT.fullName.charAt(0)}
            </div>
            <h2 className="text-xl font-bold text-brand-dark">
              {MOCK_PATIENT.fullName}
            </h2>
            <p className="text-sm text-brand-gray font-medium mb-6">
              {MOCK_PATIENT.age} años
            </p>

            <div className="flex items-center justify-center gap-6 border-t border-slate-100 pt-6">
              <div className="text-center">
                <p className="text-xs text-brand-gray font-bold uppercase tracking-wider mb-1">
                  Citas
                </p>
                <p className="text-xl font-black text-brand-dark">04</p>
              </div>
              <div className="w-px h-8 bg-slate-100"></div>
              <div className="text-center">
                <p className="text-xs text-brand-gray font-bold uppercase tracking-wider mb-1">
                  Estudios
                </p>
                <p className="text-xl font-black text-brand-dark">02</p>
              </div>
            </div>
          </motion.div>

          {/* WIDGET: HISTORIAL RÁPIDO */}
          <motion.div
            variants={item}
            className="bg-white border border-slate-200 rounded-4xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-brand-dark">Citas Pasadas</h3>
            </div>
            <PastAppointmentsList
              appointments={MOCK_PATIENT.pastAppointments}
            />
          </motion.div>

          {/* CTA FLOTANTE */}
          <motion.div variants={item}>
            <div className="bg-linear-to-br from-brand-primary to-teal-500 rounded-4xl p-6 text-white text-center shadow-lg shadow-brand-primary/20 relative overflow-hidden">
              <div className="absolute -right-10 -top-10 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
              <h3 className="text-lg font-bold mb-2 relative z-10">
                ¿Necesitas otra consulta?
              </h3>
              <p className="text-teal-50 text-sm mb-6 relative z-10">
                Agenda fácil y sin contraseñas.
              </p>
              <button className="w-full bg-white text-brand-primary font-bold py-3 rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-md relative z-10">
                Agendar Nueva Cita
              </button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </main>
  );
};
