import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export type ArcoRequestType =
  | "access"
  | "rectification"
  | "cancellation"
  | "opposition"
  | "revocation";

export type ArcoRequestStatus =
  | "received"
  | "in_progress"
  | "resolved"
  | "rejected";

export interface ArcoRequest {
  id: string;
  patientId: string;
  patientName: string | null;
  requestType: ArcoRequestType;
  details: string;
  status: ArcoRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface AuditEntry {
  id: number;
  occurredAt: string;
  actorRole: string;
  action: string;
  tableName: string;
  rowId: string | null;
  patientId: string | null;
  changedColumns: string[];
}

interface RawArcoRequest {
  id: string;
  patient_id: string;
  request_type: ArcoRequestType;
  details: string;
  status: ArcoRequestStatus;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  patients?: { first_name: string | null; last_name: string | null } | null;
}

interface RawAuditEntry {
  id: number;
  occurred_at: string;
  actor_role: string;
  action: string;
  table_name: string;
  row_id: string | null;
  patient_id: string | null;
  changed_columns: string[] | null;
}

/** RPC failures with code P0001 carry a Spanish message written for the user. */
const toUserFacingError = (error: PostgrestError, fallback: string): Error =>
  new Error(error.code === "P0001" ? error.message : fallback);

const mapArcoRequest = (r: RawArcoRequest): ArcoRequest => ({
  id: r.id,
  patientId: r.patient_id,
  patientName: r.patients
    ? `${r.patients.first_name ?? ""} ${r.patients.last_name ?? ""}`.trim()
    : null,
  requestType: r.request_type,
  details: r.details,
  status: r.status,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  resolutionNote: r.resolution_note,
});

// -----------------------------------------------------------------------------
// Patient portal
// -----------------------------------------------------------------------------

export interface MyDataExport {
  generated_at: string;
  privacy_notice_version: string;
  profile: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
    gender: string | null;
    dob: string | null;
    blood_type: string | null;
    allergies: string | null;
    chronic_conditions: string | null;
    referred_by: string | null;
    created_at: string | null;
  } | null;
  consents: { document: string; version: string; accepted_at: string }[];
  appointments: {
    service: string | null;
    start_time: string;
    status: string;
    reason: string | null;
    cancel_reason: string | null;
  }[];
  prescriptions: {
    created_at: string;
    medications: { nombre?: string; dosis?: string; indicaciones?: string }[];
  }[];
  files: { name: string; uploaded_at: string }[];
  arco_requests: {
    request_type: ArcoRequestType;
    status: ArcoRequestStatus;
    created_at: string;
    resolution_note: string | null;
  }[];
}

/**
 * Right of access / portability: everything the clinic holds about the
 * signed-in patient. The export itself is audit-logged server-side.
 */
export const fetchMyData = async (): Promise<MyDataExport> => {
  const { data, error } = await supabase.rpc("export_my_data");
  if (error) {
    console.error("[PrivacyService] export_my_data failed:", error.code);
    throw toUserFacingError(error, "No se pudieron obtener tus datos.");
  }
  return data as MyDataExport;
};

export const submitArcoRequest = async (
  requestType: ArcoRequestType,
  details: string,
): Promise<void> => {
  const { error } = await supabase.rpc("submit_arco_request", {
    p_request_type: requestType,
    p_details: details,
  });
  if (error) {
    console.error("[PrivacyService] submit_arco_request failed:", error.code);
    throw toUserFacingError(error, "No se pudo enviar tu solicitud.");
  }
};

/** The signed-in patient's own requests (RLS limits the rows). */
export const fetchMyArcoRequests = async (): Promise<ArcoRequest[]> => {
  const { data, error } = await supabase
    .from("arco_requests")
    .select(
      "id, patient_id, request_type, details, status, created_at, resolved_at, resolution_note",
    )
    .order("created_at", { ascending: false })
    .returns<RawArcoRequest[]>();

  if (error) throw new Error("No se pudieron cargar tus solicitudes.");
  return (data || []).map(mapArcoRequest);
};

// -----------------------------------------------------------------------------
// Staff
// -----------------------------------------------------------------------------

export const fetchArcoRequests = async (): Promise<ArcoRequest[]> => {
  const { data, error } = await supabase
    .from("arco_requests")
    .select(
      "id, patient_id, request_type, details, status, created_at, resolved_at, resolution_note, patients ( first_name, last_name )",
    )
    .order("created_at", { ascending: false })
    .returns<RawArcoRequest[]>();

  if (error) throw new Error("No se pudieron cargar las solicitudes.");
  return (data || []).map(mapArcoRequest);
};

export const resolveArcoRequest = async (
  requestId: string,
  status: Exclude<ArcoRequestStatus, "received">,
  resolutionNote: string,
): Promise<void> => {
  const { error } = await supabase.rpc("resolve_arco_request", {
    p_request_id: requestId,
    p_status: status,
    p_resolution_note: resolutionNote,
  });
  if (error) throw toUserFacingError(error, "No se pudo actualizar la solicitud.");
};

/**
 * Cancellation without hard deletion. The server refuses while the record is
 * inside the NOM-004 retention period and says until when.
 */
export const anonymizePatient = async (
  patientId: string,
): Promise<{ filesToReview: number }> => {
  const { data, error } = await supabase.rpc("anonymize_patient", {
    p_patient_id: patientId,
  });
  if (error) throw toUserFacingError(error, "No se pudo anonimizar el expediente.");
  const result = (data ?? {}) as { files_to_review?: number };
  return { filesToReview: result.files_to_review ?? 0 };
};

export const AUDIT_PAGE_SIZE = 30;

/** Most recent entries the Bitácora loads at once (the table pages them). */
export const AUDIT_MAX_ENTRIES = 500;

export const fetchAuditLog = async (
  patientId: string | null,
  page: number,
  pageSize: number = AUDIT_PAGE_SIZE,
): Promise<AuditEntry[]> => {
  let query = supabase
    .from("audit_log")
    .select(
      "id, occurred_at, actor_role, action, table_name, row_id, patient_id, changed_columns",
    );

  if (patientId) query = query.eq("patient_id", patientId);

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
    .returns<RawAuditEntry[]>();
  if (error) throw new Error("No se pudo cargar la bitácora.");

  return (data || []).map((e) => ({
    id: e.id,
    occurredAt: e.occurred_at,
    actorRole: e.actor_role,
    action: e.action,
    tableName: e.table_name,
    rowId: e.row_id,
    patientId: e.patient_id,
    changedColumns: e.changed_columns || [],
  }));
};
