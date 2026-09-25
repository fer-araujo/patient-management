import { useRef, useState, useEffect } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  fetchActiveServices,
  type ClinicService,
} from "../../../../lib/services/catalogService";

export const ExploreTreatmentsWidget = () => {
  const navigate = useNavigate();
  const carouselRef = useRef<HTMLDivElement>(null);
  const [treatments, setTreatments] = useState<ClinicService[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadTreatments = async () => {
      try {
        const data = await fetchActiveServices();
        // Ocultamos la consulta de valoración en este carrusel
        setTreatments(
          data.filter(
            (s) =>
              !s.name.toLowerCase().includes("valoración") &&
              !s.name.toLowerCase().includes("valoracion"),
          ),
        );
      } catch (error) {
        console.error("Error loading treatments:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadTreatments();
  }, []);

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

  // El mismo mapeador para mantener colores consistentes
  const getColorForService = (name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes("toxina") || lowerName.includes("botox"))
      return "text-rose-500 bg-rose-50 border-rose-100";
    if (lowerName.includes("hialuronico") || lowerName.includes("relleno"))
      return "text-blue-500 bg-blue-50 border-blue-100";
    if (lowerName.includes("hilos"))
      return "text-amber-500 bg-amber-50 border-amber-100";
    if (lowerName.includes("prp") || lowerName.includes("plasma"))
      return "text-fuchsia-500 bg-fuchsia-50 border-fuchsia-100";
    if (lowerName.includes("ozono") || lowerName.includes("suero"))
      return "text-cyan-500 bg-cyan-50 border-cyan-100";
    return "text-brand-primary bg-brand-light/30 border-brand-light/50";
  };

  if (isLoading) {
    return (
      <div className="w-full flex justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-brand-primary opacity-50" />
      </div>
    );
  }

  if (treatments.length === 0) return null;

  return (
    <div className="w-full relative mt-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-brand-dark">
          Explorar Tratamientos
        </h2>

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

      {/* The first card snaps to the start (not the center), and the snap area
          honors the mobile side padding, so at rest the first card is always
          fully visible and never pulled past the left edge. */}
      <div
        ref={carouselRef}
        className="flex gap-4 overflow-x-auto pb-4 snap-x hide-scrollbar -mx-4 px-4 scroll-px-4 sm:mx-0 sm:px-0 sm:scroll-px-0 scroll-smooth [&>*:first-child]:snap-start"
      >
        {treatments.map((treatment) => (
          <div
            key={treatment.id}
            className="snap-center shrink-0 w-70 bg-white border border-slate-200 rounded-3xl p-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${getColorForService(treatment.name)}`}
                >
                  {treatment.category}
                </span>
                <span className="text-[11px] font-bold text-brand-gray bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                  ⏱ {treatment.durationMins} min
                </span>
              </div>
              <h3 className="text-lg font-bold text-brand-dark mb-2 leading-tight line-clamp-1">
                {treatment.name}
              </h3>
              <p className="text-sm text-brand-gray font-medium leading-relaxed line-clamp-2">
                {treatment.description}
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
