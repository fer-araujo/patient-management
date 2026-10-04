import { useEffect, useMemo, useState } from "react";
import { History, Loader2 } from "lucide-react";
import {
  AUDIT_PAGE_SIZE,
  fetchAuditLog,
  type AuditEntry,
} from "../../../../lib/services/privacyService";
import {
  fetchPatients,
  type DashboardPatient,
} from "../../../../lib/services/patientService";

const TABLE_LABELS: Record<string, string> = {
  patients: "los datos del paciente",
  appointments: "una cita",
  clinical_notes: "una nota clínica",
  prescriptions: "las indicaciones médicas",
  patient_files: "un archivo del expediente",
  clinical_note_addenda: "una adenda",
  consents: "un consentimiento",
  arco_requests: "una solicitud ARCO",
  payments: "un cobro",
};

const ACTION_LABELS: Record<string, string> = {
  INSERT: "registró",
  UPDATE: "modificó",
  DELETE: "eliminó",
  FINALIZE: "cerró",
  EXPORT: "descargó",
  ANONYMIZE: "anonimizó",
};

const ROLE_LABELS: Record<string, string> = {
  doctor: "La doctora",
  admin: "Administración",
  patient: "El paciente",
  anon: "Un visitante sin sesión",
  service_role: "El sistema de avisos",
  system: "La consola de base de datos",
  authenticated: "Un usuario",
};

const COLUMN_LABELS: Record<string, string> = {
  first_name: "nombre",
  last_name: "apellido",
  phone: "teléfono",
  email: "correo",
  dob: "fecha de nacimiento",
  notes: "recordatorios",
  status: "estado",
  start_time: "fecha y hora",
  subjective: "motivo (S)",
  objective: "exploración (O)",
  analysis: "diagnóstico (A)",
  plan: "plan (P)",
  medications: "medicamentos",
  finalized_at: "cierre",
  cancel_reason: "motivo de cancelación",
  allergies: "alergias",
  chronic_conditions: "enfermedades crónicas",
  blood_type: "tipo de sangre",
};

const describeEntry = (entry: AuditEntry): string => {
  const who = ROLE_LABELS[entry.actorRole] ?? `Rol "${entry.actorRole}"`;
  if (entry.action === "FINALIZE") return `${who} cerró la consulta (nota e indicaciones).`;
  if (entry.action === "EXPORT") return `${who} descargó una copia de sus datos.`;
  if (entry.action === "ANONYMIZE") return `${who} anonimizó el expediente.`;
  const verb = ACTION_LABELS[entry.action] ?? entry.action;
  const what = TABLE_LABELS[entry.tableName] ?? entry.tableName;
  return `${who} ${verb} ${what}.`;
};

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Staff view of the append-only audit trail. Shows who did what and when;
 * only column NAMES are logged, never clinical values.
 */
export const AuditLogTab = () => {
  const [patients, setPatients] = useState<DashboardPatient[]>([]);
  const [patientId, setPatientId] = useState<string>("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patientNames = useMemo(
    () => new Map(patients.map((p) => [p.id, p.name])),
    [patients],
  );

  useEffect(() => {
    let active = true;
    Promise.all([fetchPatients(), fetchAuditLog(null, 0)])
      .then(([patientRows, auditRows]) => {
        if (!active) return;
        setPatients(patientRows);
        setEntries(auditRows);
        setHasMore(auditRows.length === AUDIT_PAGE_SIZE);
      })
      .catch((err: unknown) => {
        if (active)
          setError(err instanceof Error ? err.message : "Error al cargar.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadPage = async (targetPatient: string, targetPage: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await fetchAuditLog(targetPatient || null, targetPage);
      setEntries((prev) => (targetPage === 0 ? rows : [...prev, ...rows]));
      setPage(targetPage);
      setHasMore(rows.length === AUDIT_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePatientChange = (value: string) => {
    setPatientId(value);
    loadPage(value, 0);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-4 flex-1">
          <div className="w-14 h-14 bg-brand-light/40 text-brand-primary rounded-2xl flex items-center justify-center shrink-0">
            <History className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-gray uppercase tracking-wider mb-1">
              Bitácora de cambios
            </p>
            <p className="text-xs text-brand-gray">
              Quién creó, cambió o consultó el expediente. No muestra contenido
              clínico.
            </p>
          </div>
        </div>
        <select
          aria-label="Ver movimientos de"
          value={patientId}
          onChange={(e) => handlePatientChange(e.target.value)}
          className="sm:w-64 px-4 py-2.5 border-2 border-brand-light rounded-xl text-sm text-brand-dark bg-white focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition-all cursor-pointer"
        >
          <option value="">Todos los pacientes</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-600"
        >
          {error}
        </p>
      )}

      {!isLoading && entries.length === 0 && !error && (
        <p className="text-center text-brand-gray font-medium py-10">
          No hay movimientos registrados.
        </p>
      )}

      {entries.length > 0 && (
        <ul className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] divide-y divide-slate-100 overflow-hidden">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="px-5 py-3 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4"
            >
              <p className="text-xs font-semibold text-brand-gray sm:w-36 shrink-0 pt-0.5">
                {formatDateTime(entry.occurredAt)}
              </p>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-dark">
                  {describeEntry(entry)}
                </p>
                {entry.patientId && (
                  <p className="text-xs text-brand-gray">
                    Paciente:{" "}
                    {patientNames.get(entry.patientId) ??
                      "Expediente sin nombre visible"}
                  </p>
                )}
                {entry.action === "UPDATE" && entry.changedColumns.length > 0 && (
                  <p className="text-xs text-brand-gray">
                    Cambió:{" "}
                    {entry.changedColumns
                      .map((c) => COLUMN_LABELS[c] ?? c)
                      .join(", ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isLoading && (
        <div className="flex justify-center py-6">
          <Loader2
            className="w-8 h-8 animate-spin text-brand-primary"
            aria-label="Cargando"
          />
        </div>
      )}

      {hasMore && !isLoading && (
        <button
          type="button"
          onClick={() => loadPage(patientId, page + 1)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-brand-dark transition-colors cursor-pointer"
        >
          Ver movimientos anteriores
        </button>
      )}
    </div>
  );
};
