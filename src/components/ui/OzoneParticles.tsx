import { useState, useEffect } from "react";
import { motion } from "framer-motion";

// --- COMPONENTE EXTRA: Micro-Burbujas de Ozono (Corregido) ---
export const OzoneParticles = () => {
  const [particles, setParticles] = useState<Array<{ id: number; left: string; size: number; delay: number; duration: number }>>([]);

  useEffect(() => {
    const generated = Array.from({ length: 15 }).map((_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      size: Math.random() * 6 + 2, 
      // Redujimos el delay al mínimo para que arranquen casi de inmediato
      delay: Math.random() * 2, 
      // Mantenemos la subida lenta y elegante
      duration: Math.random() * 20 + 15, 
    }));
    setParticles(generated);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute bottom-[-5%] rounded-full bg-brand-primary/20 backdrop-blur-md"
          style={{ left: p.left, width: p.size, height: p.size }}
          animate={{ 
            // eslint-disable-next-line react-hooks/purity
            y: [`${Math.random() * 80 - 40}vh`, "-110vh"],
            // eslint-disable-next-line react-hooks/purity
            x: ["0px", `${Math.random() * 80 - 40}px`], 
            // Aparecen al 100%, se mantienen, desaparecen al final
            opacity: [0, 0.8, 0.8, 0] 
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "linear",
            // Controlamos los tiempos de la opacidad: 
            // 0% (inicio), 10% (ya están visibles), 90% (siguen visibles), 100% (se apagan)
            times: [0, 0.05, 0.9, 1] 
          }}
        />
      ))}
    </div>
  );
};