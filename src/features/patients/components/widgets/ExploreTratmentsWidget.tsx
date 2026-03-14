import { useRef } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CLINIC_SERVICES } from "../../../../data/mockServices";

export const ExploreTreatmentsWidget = () => {
  const navigate = useNavigate();
  const carouselRef = useRef<HTMLDivElement>(null);

  const scrollLeft = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: -320, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: 320, behavior: "smooth" });
    }
  };

  return (
    <div className="w-full relative mt-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-brand-dark">
          Explorar Tratamientos
        </h2>

        {/* FLECHAS DE NAVEGACIÓN (Desktop friendly) */}
        <div className="items-center gap-2 hidden sm:flex">
          <button
            onClick={scrollLeft}
            className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-brand-dark hover:bg-brand-light/50 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={scrollRight}
            className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-brand-dark hover:bg-brand-light/50 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* CARRUSEL HORIZONTAL CON REF */}
      <div
        ref={carouselRef}
        className="flex gap-4 overflow-x-auto pb-4 snap-x hide-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 scroll-smooth"
      >
        {CLINIC_SERVICES.map((treatment) => (
          <div
            key={treatment.id}
            className="snap-center shrink-0 w-70 bg-white border border-slate-200 rounded-3xl p-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${treatment.color}`}
                >
                  {treatment.category}
                </span>
                <span className="text-[11px] font-bold text-brand-gray bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                  ⏱ {treatment.duration}
                </span>
              </div>
              <h3 className="text-lg font-bold text-brand-dark mb-2 leading-tight line-clamp-1">
                {treatment.name}
              </h3>
              <p className="text-sm text-brand-gray font-medium leading-relaxed line-clamp-2">
                {treatment.desc}
              </p>
            </div>

            <button
              onClick={() =>
                navigate("/dashboard/agendar", {
                  state: { preselectedService: treatment.id },
                })
              }
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-3 rounded-2xl text-sm font-bold text-brand-dark bg-slate-50 hover:bg-brand-light/30 border border-slate-100 hover:border-brand-light transition-all cursor-pointer group"
            >
              Me interesa
              <ArrowRight className="w-4 h-4 text-brand-primary group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
