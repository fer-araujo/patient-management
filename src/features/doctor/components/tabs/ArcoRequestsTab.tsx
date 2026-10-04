import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, ShieldCheck, UserX } from "lucide-react";
import {
  anonymizePatient,
  fetchArcoRequests,
  resolveArcoRequest,
  type ArcoRequest,
  type ArcoRequestStatus,
} from "../../../../lib/services/privacyService";
import {
  ARCO_STATUS_LABELS,
  ARCO_TYPE_LABELS,
} from "../../../../lib/legal/arcoLabels";
import {
  ARCO_EFFECTIVE_BUSINESS_DAYS,
  ARCO_RESPONSE_BUSINESS_DAYS,
  addBusinessDays,
} from "../../../../lib/legal/privacyNotice";

const formatDate = (date: Date | string): string =>
  new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const isOpen = (r: ArcoRequest) =>
  r.status === "received" || r.status === "in_progress";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-brand-dark transition-colors disabled:opacity-50 cursor-pointer";

interface RequestCardProps {
  request: ArcoRequest;
  onChanged: () => void;
}

const RequestCard = ({ request, onChanged }: RequestCardProps) => {
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [confirmAnonymize, setConfirmAnonymize] = useState(false);

  const dueDate = addBusinessDays(
    new Date(request.createdAt),
    ARCO_RESPONSE_BUSINESS_DAYS,
  );
  const isOverdue = isOpen(request) && dueDate.getTime() < Date.now();
  const type = ARCO_TYPE_LABELS[request.requestType];
  const status = ARCO_STATUS_LABELS[request.status];

  const handleStatus = async (
    nextStatus: Exclude<ArcoRequestStatus, "received">,
  ) => {
    setIsSaving(true);
    try {
      await resolveArcoRequest(request.id, nextStatus, note);
      toast.success("Solicitud actualizada.");
      setNote("");
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo actualizar la solicitud.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAnonymize = async () => {
    setIsSaving(true);
    try {
      const { filesToReview } = await anonymizePatient(request.patientId);
      toast.success(
        filesToReview > 0
          ? `Expediente anonimizado. Revisa y borra a mano ${filesToReview} archivo(s) en el almacenamiento.`
          : "Expediente anonimizado.",
        { duration: 10000 },
      );
      setConfirmAnonymize(false);
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo anonimizar el expediente.",
        { duration: 10000 },
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <li className="bg-white border border-slate-200 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-brand-dark">
            {request.patientName || "Paciente"}
          </h3>
          <p className="text-xs font-bold text-brand-gray uppercase tracking-wider">
            {type.title} · Recibida el {formatDate(request.createdAt)}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      {isOpen(request) && (
        <p
          className={`text-xs font-semibold ${isOverdue ? "text-rose-600" : "text-brand-gray"}`}
          title={`${ARCO_RESPONSE_BUSINESS_DAYS} días hábiles para responder y ${ARCO_EFFECTIVE_BUSINESS_DAYS} más para aplicar el cambio. Fecha aproximada: no descuenta días festivos.`}
        >
          {isOverdue ? "Plazo vencido: " : "Responder a más tardar el "}
          {formatDate(dueDate)}
        </p>
      )}

      <p className="text-sm text-brand-dark whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2">
        {request.details}
      </p>

      {request.resolutionNote && (
        <p className="text-sm text-brand-dark">
          <strong>Respuesta:</strong> {request.resolutionNote}
          {request.resolvedAt && (
            <span className="block text-xs text-brand-gray">
              Cerrada el {formatDate(request.resolvedAt)}
            </span>
          )}
        </p>
      )}

      {isOpen(request) && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <textarea
            aria-label="Respuesta para el paciente"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Respuesta para el paciente. Ej. Se corrigió su correo."
            rows={2}
            className="w-full px-3 py-2.5 border-2 border-brand-light rounded-xl text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all resize-none"
          />
          <div className="flex flex-wrap gap-2">
            {request.status === "received" && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleStatus("in_progress")}
                className={secondaryButton}
              >
                Marcar en trámite
              </button>
            )}
            <button
              type="button"
              disabled={isSaving || !note.trim()}
              onClick={() => handleStatus("resolved")}
              className="inline-flex items-center justify-center rounded-xl bg-brand-primary hover:bg-brand-primary-hover px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-50 cursor-pointer"
            >
              Marcar como atendida
            </button>
            <button
              type="button"
              disabled={isSaving || !note.trim()}
              onClick={() => handleStatus("rejected")}
              className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Rechazar
            </button>
          </div>
        </div>
      )}

      {request.requestType === "cancellation" && (
        <div className="border-t border-slate-100 pt-3">
          {!confirmAnonymize ? (
            <button
              type="button"
              disabled={isSaving}
              onClick={() => setConfirmAnonymize(true)}
              className={secondaryButton}
            >
              <UserX className="w-4 h-4" aria-hidden="true" />
              Anonimizar expediente
            </button>
          ) : (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-3">
              <p className="text-xs text-amber-800 leading-relaxed">
                Se borran nombre, teléfono, correo y recordatorios. Las notas
                clínicas se conservan sin nombre. No se puede deshacer, y el
                sistema no lo permite antes de 5 años desde la última consulta.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleAnonymize}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-500 hover:bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSaving && (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  )}
                  Sí, anonimizar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAnonymize(false)}
                  className={secondaryButton}
                >
                  No, regresar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

/** Staff list of ARCO requests (LFPDPPP 2025, arts. 21-34). */
export const ArcoRequestsTab = () => {
  const [requests, setRequests] = useState<ArcoRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetchArcoRequests()
      .then((rows) => {
        if (active) setRequests(rows);
      })
      .catch((err: unknown) => {
        console.error("[ArcoRequestsTab] load failed:", err);
        toast.error("No se pudieron cargar las solicitudes.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const openCount = requests.filter(isOpen).length;

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-brand-primary mb-4" />
        <p className="text-brand-gray font-medium">Cargando solicitudes...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center gap-4">
        <div className="w-14 h-14 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <div>
          <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
            Solicitudes pendientes
          </p>
          <h4 className="text-3xl font-black text-brand-dark leading-none">
            {openCount}
          </h4>
        </div>
        <p className="ml-auto text-xs text-brand-gray max-w-xs text-right hidden sm:block">
          Datos personales (ARCO). La ley da {ARCO_RESPONSE_BUSINESS_DAYS} días
          hábiles para responder.
        </p>
      </div>

      {requests.length === 0 ? (
        <p className="text-center text-brand-gray font-medium py-10">
          No hay solicitudes.
        </p>
      ) : (
        <ul className="space-y-4">
          {requests.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              onChanged={() => setReloadKey((k) => k + 1)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
