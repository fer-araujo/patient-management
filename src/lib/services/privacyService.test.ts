import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  AUDIT_PAGE_SIZE,
  anonymizePatient,
  fetchArcoRequests,
  fetchAuditLog,
  fetchMyArcoRequests,
  fetchMyData,
  resolveArcoRequest,
  submitArcoRequest,
} from "./privacyService";

const p0001 = (message: string) => ({ error: { message, code: "P0001" } });

describe("fetchMyData", () => {
  it("returns the export_my_data payload as-is", async () => {
    const payload = { generated_at: "2026-09-24T18:00:00Z", profile: null };
    supabaseMock.onRpc("export_my_data", { data: payload });

    await expect(fetchMyData()).resolves.toBe(payload);
    expect(supabaseMock.rpcCalls().map((c) => c.name)).toEqual(["export_my_data"]);
  });

  it("surfaces the server's Spanish message when no record is linked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc(
      "export_my_data",
      p0001("No encontramos un expediente clínico vinculado a tu cuenta."),
    );

    await expect(fetchMyData()).rejects.toThrow(
      "No encontramos un expediente clínico vinculado a tu cuenta.",
    );
  });

  it("does not log the error message itself (it may contain personal data)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("export_my_data", {
      error: { message: "secret detail about +525512345678", code: "XX000" },
    });

    await expect(fetchMyData()).rejects.toThrow("No se pudieron obtener tus datos.");
    expect(JSON.stringify(log.mock.calls)).not.toContain("+525512345678");
  });
});

describe("submitArcoRequest", () => {
  it("sends the request type and details", async () => {
    await submitArcoRequest("rectification", "Mi apellido está mal escrito");

    expect(supabaseMock.lastRpc("submit_arco_request")?.args).toEqual({
      p_request_type: "rectification",
      p_details: "Mi apellido está mal escrito",
    });
  });

  it("surfaces the server's limit message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc(
      "submit_arco_request",
      p0001("Ya tienes solicitudes abiertas. Espera la respuesta."),
    );
    await expect(submitArcoRequest("access", "x")).rejects.toThrow(
      "Ya tienes solicitudes abiertas. Espera la respuesta.",
    );
  });
});

describe("ARCO request lists", () => {
  const raw = {
    id: "r1",
    patient_id: "p1",
    request_type: "access",
    details: "Quiero mi resumen clínico",
    status: "received",
    created_at: "2026-09-20T16:00:00Z",
    resolved_at: null,
    resolution_note: null,
  };

  it("maps the patient's own requests without joining patient names", async () => {
    supabaseMock.onFrom("arco_requests", { data: [raw] });

    const [request] = await fetchMyArcoRequests();

    expect(request).toEqual({
      id: "r1",
      patientId: "p1",
      patientName: null,
      requestType: "access",
      details: "Quiero mi resumen clínico",
      status: "received",
      createdAt: "2026-09-20T16:00:00Z",
      resolvedAt: null,
      resolutionNote: null,
    });
    const query = supabaseMock.queries("arco_requests")[0];
    expect(String(query.args("select")?.[0])).not.toContain("patients");
    expect(query.args("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("joins the patient name for staff", async () => {
    supabaseMock.onFrom("arco_requests", {
      data: [{ ...raw, patients: { first_name: "Ana", last_name: "Pérez" } }],
    });

    const [request] = await fetchArcoRequests();

    expect(request.patientName).toBe("Ana Pérez");
    expect(String(supabaseMock.queries("arco_requests")[0].args("select")?.[0])).toContain(
      "patients ( first_name, last_name )",
    );
  });

  it("throws a Spanish message on failure", async () => {
    supabaseMock.onFrom("arco_requests", { error: { message: "denied" } });
    await expect(fetchArcoRequests()).rejects.toThrow(
      "No se pudieron cargar las solicitudes.",
    );
  });
});

describe("staff actions", () => {
  it("resolves a request with status and note", async () => {
    await resolveArcoRequest("r1", "resolved", "Se envió el resumen.");
    expect(supabaseMock.lastRpc("resolve_arco_request")?.args).toEqual({
      p_request_id: "r1",
      p_status: "resolved",
      p_resolution_note: "Se envió el resumen.",
    });
  });

  it("anonymizes a patient and reports the files left to review", async () => {
    supabaseMock.onRpc("anonymize_patient", { data: { files_to_review: 3 } });
    await expect(anonymizePatient("p1")).resolves.toEqual({ filesToReview: 3 });
    expect(supabaseMock.lastRpc("anonymize_patient")?.args).toEqual({ p_patient_id: "p1" });
  });

  it("surfaces the retention-period refusal from the server", async () => {
    supabaseMock.onRpc(
      "anonymize_patient",
      p0001("El expediente debe conservarse hasta el 2031-09-20."),
    );
    await expect(anonymizePatient("p1")).rejects.toThrow(
      "El expediente debe conservarse hasta el 2031-09-20.",
    );
  });
});

describe("fetchAuditLog", () => {
  it("pages the log and filters by patient when given", async () => {
    supabaseMock.onFrom("audit_log", {
      data: [
        {
          id: 7,
          occurred_at: "2026-09-24T18:00:00Z",
          actor_role: "doctor",
          action: "UPDATE",
          table_name: "patients",
          row_id: "p1",
          patient_id: "p1",
          changed_columns: null,
        },
      ],
    });

    const entries = await fetchAuditLog("p1", 2);

    const query = supabaseMock.queries("audit_log")[0];
    expect(query.args("eq")).toEqual(["patient_id", "p1"]);
    expect(query.args("range")).toEqual([2 * AUDIT_PAGE_SIZE, 3 * AUDIT_PAGE_SIZE - 1]);
    expect(entries[0]).toMatchObject({ id: 7, actorRole: "doctor", changedColumns: [] });
  });

  it("does not filter when no patient is selected", async () => {
    await fetchAuditLog(null, 0);
    const query = supabaseMock.queries("audit_log")[0];
    expect(query.has("eq")).toBe(false);
    expect(query.args("range")).toEqual([0, AUDIT_PAGE_SIZE - 1]);
  });
});
