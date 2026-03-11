import type { ReactNode } from "react";

interface BadgeProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  className?: string;
}

export const Badge = ({
  icon,
  title,
  subtitle,
  className = "",
}: BadgeProps) => {
  return (
    <div
      className={`bg-white/80 backdrop-blur-md border border-white/50 shadow-xl shadow-brand-dark/5 rounded-2xl p-4 flex items-center gap-4 w-max min-w-60 ${className}`}
    >
      <div className="bg-brand-light/50 p-2.5 rounded-xl text-brand-primary">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-brand-dark leading-tight">
          {title}
        </p>
        <p className="text-[10px] font-semibold text-brand-gray mt-0.5 uppercase tracking-wide">
          {subtitle}
        </p>
      </div>
    </div>
  );
};
