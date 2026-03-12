import { HeartPulse } from "lucide-react";

export const Header = () => {
  return (
    <header className="bg-white border-b border-brand-light/50 sticky top-0 z-30 px-6 py-4 flex justify-between items-center shadow-sm shadow-brand-primary/5">
      <div className="flex items-center gap-3">
        <div className="bg-brand-light/50 p-2 rounded-xl text-brand-primary">
          <HeartPulse className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <span className="font-extrabold text-brand-dark tracking-tight text-xl">
          Clínica Torres
        </span>
      </div>
    </header>
  );
};