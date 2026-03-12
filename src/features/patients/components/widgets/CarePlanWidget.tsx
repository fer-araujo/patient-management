import { Pill, Sparkles } from "lucide-react";

interface CareItem {
  id: number;
  type: string;
  name: string;
  instruction: string;
  daysLeft: string;
}

export const CarePlanWidget = ({ plan }: { plan: CareItem[] }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {plan.map((item) => (
      <div
        key={item.id}
        className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex gap-4"
      >
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${item.type === "med" ? "bg-indigo-50 text-indigo-500" : "bg-orange-50 text-orange-500"}`}
        >
          {item.type === "med" ? (
            <Pill className="w-6 h-6" />
          ) : (
            <Sparkles className="w-6 h-6" />
          )}
        </div>
        <div>
          <h4 className="font-bold text-brand-dark mb-0.5">{item.name}</h4>
          <p className="text-sm text-brand-gray font-medium mb-2">
            {item.instruction}
          </p>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
            {item.daysLeft}
          </span>
        </div>
      </div>
    ))}
  </div>
);
