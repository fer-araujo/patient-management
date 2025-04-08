import { motion } from "framer-motion";
import React from "react";

const Spinner = ({
  text = false,
  size = "md",
}: {
  text?: boolean;
  size?: "sm" | "md" | "lg";
}) => {
  const sizeMap = {
    sm: "w-4 h-4 border-2",
    md: "w-8 h-8 border-4",
    lg: "w-14 h-14 border-4",
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className={`flex ${text ? "flex-col items-center gap-4" : "items-center justify-center"}`}
    >
      <div
        className={`${sizeMap[size]} border-green-500 border-t-transparent rounded-full animate-spin`}
      />
      {text && <p className="text-sm text-dark-600">Cargando...</p>}
    </motion.div>
  );
};

export default Spinner;
