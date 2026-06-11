import { useRef } from "react";
import { Upload, Leaf, FileText, ChevronRight } from "lucide-react";

interface QuickActionsProps {
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenCareGuide: () => void;
  onOpenRecipe: () => void;
}

export const QuickActionsWidget = ({
  onFileUpload,
  onOpenCareGuide,
  onOpenRecipe,
}: QuickActionsProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 1. ESTUDIOS - Premium Horizontal */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-teal-200 transition-all group"
        >
          <input
            type="file"
            accept="image/*, application/pdf"
            className="hidden"
            ref={fileInputRef}
            onChange={onFileUpload}
          />
          {/* FIX: Contenedor cuadrado w-12 h-12 */}
          <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <Upload className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">
              Estudios
            </h3>
            <p className="text-[12px] text-brand-gray font-medium leading-tight">
              Subir laboratorios
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-teal-500 transition-colors shrink-0" />
        </div>

        {/* 2. MI RECETA - Premium Horizontal */}
        <div
          onClick={onOpenRecipe}
          className="cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-indigo-200 transition-all group"
        >
          {/* FIX: Contenedor cuadrado w-12 h-12 */}
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <FileText className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">
              Mi Receta
            </h3>
            <p className="text-[12px] text-brand-gray font-medium leading-tight">
              Indicaciones médicas
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
        </div>

        {/* 3. CUIDADOS - Premium Horizontal */}
        <div
          onClick={onOpenCareGuide}
          className="cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-violet-200 transition-all group"
        >
          {/* FIX: Contenedor cuadrado w-12 h-12 */}
          <div className="w-12 h-12 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <Leaf className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">
              Cuidados
            </h3>
            <p className="text-[12px] text-brand-gray font-medium leading-tight">
              Post-tratamiento
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-violet-500 transition-colors shrink-0" />
        </div>
      </div>

      {/* =========================================================
          TODO: MVP Fase 2 - Facturación
          ========================================================= */}
      {/* <div className="cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-blue-200 transition-all mt-4 group">
        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
          <Receipt className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div className="flex-1 text-left">
          <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">Solicitar Factura</h3>
          <p className="text-[12px] text-brand-gray font-medium leading-tight">De tu última cita</p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
      </div> */}
    </>
  );
};