import { useRef } from "react";
import { Upload, Leaf } from "lucide-react";

interface QuickActionsProps {
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenCareGuide?: () => void; // Para abrir el modal de cuidados post-tratamiento en el futuro
}

export const QuickActionsWidget = ({
  onFileUpload,
  onOpenCareGuide,
}: QuickActionsProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      {/* 1. SUBIR ESTUDIOS (Teal) */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer bg-teal-50 hover:bg-teal-100/50 border border-teal-200 rounded-3xl p-5 group transition-all shadow-[0_2px_10px_rgb(0,0,0,0.02)]"
      >
        <input
          type="file"
          accept="image/*, application/pdf"
          className="hidden"
          ref={fileInputRef}
          onChange={onFileUpload}
        />
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-teal-950 mb-0.5">
              Subir Estudios
            </h3>
            <p className="text-sm text-teal-700 font-medium">
              Labs o Radiografías
            </p>
          </div>
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-teal-600 shadow-sm group-hover:scale-105 transition-transform">
            <Upload className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 2. CUIDADOS POST-TRATAMIENTO (Violeta/Lila suave para regeneración) */}
      <div
        onClick={onOpenCareGuide}
        className="cursor-pointer bg-violet-50 hover:bg-violet-100/50 border border-violet-200 rounded-3xl p-5 group transition-all shadow-[0_2px_10px_rgb(0,0,0,0.02)]"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-violet-950 mb-0.5">
              Guía de Cuidados
            </h3>
            <p className="text-sm text-violet-700 font-medium">
              Post-tratamiento
            </p>
          </div>
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-violet-500 shadow-sm group-hover:scale-105 transition-transform">
            <Leaf className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* =========================================================
          TODO: MVP Fase 2 - Facturación (Descomentar cuando el nuevo consultorio esté listo fiscalmente)
          ========================================================= */}
      {/* <div className="cursor-pointer bg-blue-50 hover:bg-blue-100/50 border border-blue-200 rounded-3xl p-5 group transition-all shadow-[0_2px_10px_rgb(0,0,0,0.02)] sm:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-blue-950 mb-0.5">
              Solicitar Factura
            </h3>
            <p className="text-sm text-blue-700 font-medium">
              De tu última cita
            </p>
          </div>
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-blue-500 shadow-sm group-hover:scale-105 transition-transform">
            <Receipt className="w-5 h-5" />
          </div>
        </div>
      </div> 
      */}
    </>
  );
};
