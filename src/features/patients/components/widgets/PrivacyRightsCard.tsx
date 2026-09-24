import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Loader2,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
import {
  fetchMyArcoRequests,
  fetchMyData,
  submitArcoRequest,
  type ArcoRequest,
  type ArcoRequestType,
} from "../../../../lib/services/privacyService";
import {
  ARCO_FORM_TYPES,
  ARCO_STATUS_LABELS,
  ARCO_TYPE_LABELS,
} from "../../../../lib/legal/arcoLabels";
import {
  ARCO_EFFECTIVE_BUSINESS_DAYS,
  ARCO_RESPONSE_BUSINESS_DAYS,
} from "../../../../lib/legal/privacyNotice";
import {
  openMyDataWindow,
  renderMyDataDocument,
} from "../../utils/printMyData";

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * ARCO rights in the patient portal (LFPDPPP 2025, arts. 22-31), presented as
 * a mini card matching the quick actions. It opens a compact modal with the
 * data download and the request form.
 */
export const PrivacyRightsCard = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"menu" | "form">("menu");
  const [isDownloading, setIsDownloading] = useState(false);
  const [requestType, setRequestType] = useState<ArcoRequestType | null>(null);
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requests, setRequests] = useState<ArcoRequest[]>([]);

  useEffect(() => {
    let active = true;
    fetchMyArcoRequests()
      .then((rows) => {
        if (active) setRequests(rows);
      })
      .catch((err) =>
        console.error("[PrivacyRightsCard] load requests failed:", err),
      );
    return () => {
      active = false;
    };
  }, []);

  const close = () => {
    setIsOpen(false);
    setView("menu");
    setRequestType(null);
    setDetails("");
  };

  const handleDownload = async () => {
    // Opened synchronously on the click so the browser does not block it.
    const win = openMyDataWindow();
    if (!win) {
      toast.error("Permite las ventanas emergentes para ver tus datos.");
      return;
    }
    setIsDownloading(true);
    try {
      renderMyDataDocument(win, await fetchMyData());
    } catch (err) {
      win.close();
      toast.error(
        err instanceof Error ? err.message : "No se pudieron obtener tus datos.",
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestType || details.trim().length < 5) return;
    setIsSubmitting(true);
    try {
      await submitArcoRequest(requestType, details.trim());
      toast.success("Recibimos tu solicitud. Te responderemos por este medio.");
      setRequests(await fetchMyArcoRequests());
      setView("menu");
      setRequestType(null);
      setDetails("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo enviar tu solicitud.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full text-left cursor-pointer bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-[0_4px_15px_rgb(0,0,0,0.05)] hover:border-blue-200 transition-all group"
      >
        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
          <ShieldCheck className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-extrabold text-brand-dark mb-0.5">
            Mis datos personales
          </h3>
          <p className="text-[12px] text-brand-gray font-medium leading-tight">
            Descargar o pedir un cambio
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
      </button>

      <Modal
        isOpen={isOpen}
        onClose={close}
        title="Mis datos personales"
        icon={<ShieldCheck className="w-5 h-5 text-brand-primary" />}
        hideFooter={true}
        maxWidth="max-w-md"
      >
        {view === "menu" ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className="w-full text-left cursor-pointer bg-white border-2 border-brand-light rounded-xl p-3 flex items-center gap-3 hover:border-brand-primary/40 transition-all disabled:opacity-60"
            >
              <div className="w-10 h-10 bg-brand-light text-brand-primary rounded-lg flex items-center justify-center shrink-0">
                {isDownloading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" strokeWidth={2.5} />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-brand-dark">
                  Ver y descargar mis datos
                </p>
                <p className="text-xs text-brand-gray font-medium">
                  Un documento para leer, imprimir o guardar en PDF.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setView("form")}
              className="w-full text-left cursor-pointer bg-white border-2 border-brand-light rounded-xl p-3 flex items-center gap-3 hover:border-brand-primary/40 transition-all"
            >
              <div className="w-10 h-10 bg-brand-light text-brand-primary rounded-lg flex items-center justify-center shrink-0">
                <Send className="w-4 h-4" strokeWidth={2.5} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-brand-dark">
                  Pedir un cambio
                </p>
                <p className="text-xs text-brand-gray font-medium">
                  Resumen clínico, corregir o borrar mis datos.
                </p>
              </div>
            </button>

            {requests.length > 0 && (
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <p className="text-xs font-bold text-brand-gray uppercase tracking-wider">
                  Mis solicitudes
                </p>
                {requests.map((r) => (
                  <div key={r.id} className="bg-slate-50 rounded-xl px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-brand-dark">
                        {ARCO_TYPE_LABELS[r.requestType].title}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ARCO_STATUS_LABELS[r.status].className}`}
                      >
                        {ARCO_STATUS_LABELS[r.status].label}
                      </span>
                    </div>
                    <p className="text-xs text-brand-gray">
                      Enviada el {formatDate(r.createdAt)}
                    </p>
                    {r.resolutionNote && (
                      <p className="text-xs text-brand-dark mt-1">
                        <strong>Respuesta:</strong> {r.resolutionNote}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <button
              type="button"
              onClick={() => setView("menu")}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-gray hover:text-brand-primary cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver
            </button>

            <fieldset className="space-y-2">
              <legend className="text-sm font-bold text-brand-dark mb-2">
                ¿Qué quieres hacer?
              </legend>
              {ARCO_FORM_TYPES.map((type) => {
                const selected = requestType === type;
                return (
                  <label
                    key={type}
                    className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 cursor-pointer transition-all ${selected ? "border-brand-primary bg-brand-light/40" : "border-brand-light bg-white hover:border-brand-primary/40"}`}
                  >
                    <input
                      type="radio"
                      name="arco-type"
                      value={type}
                      checked={selected}
                      onChange={() => setRequestType(type)}
                      className="w-4 h-4 shrink-0 accent-brand-primary"
                    />
                    <span>
                      <span className="block text-sm font-bold text-brand-dark">
                        {ARCO_TYPE_LABELS[type].title}
                      </span>
                      <span className="block text-xs text-brand-gray">
                        {ARCO_TYPE_LABELS[type].description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {requestType === "cancellation" && (
              <p className="rounded-xl bg-brand-light/60 px-3 py-2 text-xs text-brand-dark leading-relaxed">
                Por ley, tu expediente clínico se conserva al menos 5 años desde
                tu última consulta. Tus datos de contacto sí pueden dejar de
                usarse desde ahora.
              </p>
            )}

            <textarea
              aria-label="Cuéntanos qué necesitas"
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 4000))}
              placeholder="Cuéntanos qué necesitas. Ej. Mi correo correcto es..."
              rows={3}
              className="w-full px-4 py-3 border-2 border-brand-light rounded-xl text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all resize-none"
            />

            <p className="text-xs text-brand-gray leading-relaxed">
              Respuesta en máximo {ARCO_RESPONSE_BUSINESS_DAYS} días hábiles; si
              procede, el cambio se aplica en los {ARCO_EFFECTIVE_BUSINESS_DAYS}{" "}
              días hábiles siguientes.
            </p>

            <Button
              type="submit"
              disabled={isSubmitting || !requestType || details.trim().length < 5}
              className="disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? "Enviando..." : "Enviar solicitud"}
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
};
