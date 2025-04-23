import { bgColors, getInitials, stringHash, textColorMap } from "@/lib/utils";
import { FC, useMemo } from "react";

const PatientCell: FC<{ name: string }> = ({ name }) => {
  // Componente para la celda de paciente con avatar
  const initials = useMemo(() => getInitials(name), [name]);
  const hash = stringHash(name);
  const index = Math.abs(hash) % bgColors.length;
  const bgColor = bgColors[index];
  const textColor = textColorMap[bgColor] || "text-black";
    const className = `flex h-8 w-8 items-center justify-center rounded-full ${bgColor} ${textColor}`;
  return (
    <div className="flex items-center gap-2">
      <div
        className={className}
      >
        <span className="text-sm font-medium">{initials}</span>
      </div>
      <p className="text-sm font-light">{name}</p>
    </div>
  );
};

export default PatientCell;
