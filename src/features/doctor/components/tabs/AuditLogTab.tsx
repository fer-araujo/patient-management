import { useEffect, useMemo, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { Dropdown } from "../../../../components/ui/Dropdown";
import { DataGrid, type ColumnDef } from "../../../../components/ui/DataGrid";
import {
  AUDIT_MAX_ENTRIES,
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
  arco_requests: "una solicitud de datos personales",
  payments: "un cobro",
  service_supplies: "los insumos de un tratamiento",
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
  prognosis: "pronóstico",
  vital_signs: "signos vitales",
  medications: "medicamentos",
  finalized_at: "cierre",
  cancel_reason: "motivo de cancelación",
  allergies: "alergias",
  chronic_conditions: "enfermedades crónicas",
  blood_type: "tipo de sangre",
  gender: "género",
  referred_by: "referido por",
  address: "domicilio",
  family_history: "antecedentes heredofamiliares",
  personal_pathological_history: "antecedentes personales patológicos",
  non_pathological_history: "antecedentes personales no patológicos",
  current_illness: "padecimiento actual",
  anonymized_at: "anonimización",
};

const actorLabel = (entry: AuditEntry): string =>
  ROLE_LABELS[entry.actorRole] ?? `Rol "${entry.actorRole}"`;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const actionLabel = (entry: AuditEntry): string => {
  if (entry.action === "FINALIZE") return "Cerró la consulta (nota e indicaciones)";
  if (entry.action === "EXPORT") return "Descargó una copia de sus datos";
  if (entry.action === "ANONYMIZE") return "Anonimizó el expediente";
  const verb = ACTION_LABELS[entry.action] ?? entry.action;
  const what = TABLE_LABELS[entry.tableName] ?? entry.tableName;
  return capitalize(`${verb} ${what}`);
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
  // True when the load hit AUDIT_MAX_ENTRIES: older entries exist, reachable
  // by filtering by patient.
  const [isCapped, setIsCapped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patientNames = useMemo(
    () => new Map(patients.map((p) => [p.id, p.name])),
    [patients],
  );

  useEffect(() => {
    let active = true;
    Promise.all([fetchPatients(), fetchAuditLog(null, 0, AUDIT_MAX_ENTRIES)])
      .then(([patientRows, auditRows]) => {
        if (!active) return;
        setPatients(patientRows);
        setEntries(auditRows);
        setIsCapped(auditRows.length === AUDIT_MAX_ENTRIES);
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

  const loadEntries = async (targetPatient: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await fetchAuditLog(
        targetPatient || null,
        0,
        AUDIT_MAX_ENTRIES,
      );
      setEntries(rows);
      setIsCapped(rows.length === AUDIT_MAX_ENTRIES);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePatientChange = (value: string) => {
    setPatientId(value);
    loadEntries(value);
  };

  const columns: ColumnDef<AuditEntry>[] = [
    {
      header: "Fecha",
      cell: (e) => (
        <span className="text-sm text-brand-gray whitespace-nowrap">
          {formatDateTime(e.occurredAt)}
        </span>
      ),
    },
    {
      header: "Quién",
      cell: (e) => (
        <span className="text-sm font-bold text-brand-dark">{actorLabel(e)}</span>
      ),
    },
    {
      header: "Acción",
      cell: (e) => (
        <span className="text-sm text-brand-dark">{actionLabel(e)}</span>
      ),
    },
    {
      header: "Paciente",
      cell: (e) => (
        <span className="text-sm text-brand-dark">
          {e.patientId
            ? (patientNames.get(e.patientId) ?? "Expediente sin nombre visible")
            : "—"}
        </span>
      ),
    },
    {
      header: "Cambios",
      cell: (e) => (
        <span className="text-sm text-brand-gray">
          {e.action === "UPDATE" && e.changedColumns.length > 0
            ? e.changedColumns.map((c) => COLUMN_LABELS[c] ?? c).join(", ")
            : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <p className="text-xs text-brand-gray flex items-center gap-2">
          <History className="w-4 h-4 text-brand-primary shrink-0" />
          Registro permanente de quién creó, cambió o consultó el expediente.
          No muestra contenido clínico.
        </p>
        <Dropdown
          className="w-full sm:w-64"
          value={patientId}
          onChange={handlePatientChange}
          searchable
          options={[
            { label: "Todos los pacientes", value: "" },
            ...patients.map((p) => ({ label: p.name, value: p.id })),
          ]}
        />
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
        <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <DataGrid
            data={entries}
            columns={columns}
            keyExtractor={(e) => e.id}
            itemsPerPage={10}
          />
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-6">
          <Loader2
            className="w-8 h-8 animate-spin text-brand-primary"
            aria-label="Cargando"
          />
        </div>
      )}

      {isCapped && !isLoading && (
        <p className="text-xs text-brand-gray text-center">
          Se muestran los {AUDIT_MAX_ENTRIES} movimientos más recientes. Filtra
          por paciente para ver movimientos anteriores.
        </p>
      )}
    </div>
  );
};
