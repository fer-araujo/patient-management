// Concurrency test for the staff booking RPC (see load/README.md first).
//
// Signs in ONCE as the doctor (Supabase Auth password grant), then 20 virtual
// users call staff_create_appointment for the SAME slot at the same moment.
// The booking lock (pg_advisory_xact_lock + assert_slot_free) must let exactly
// one through and refuse the other 19 with the overlap message (P0001).
//
// Never logs the access token: setup() returns it to the VUs only, and
// handleSummary() prints the metrics, never `data.setup_data`.

import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

const VUS = 20;

const SUPABASE_URL = (__ENV.K6_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = __ENV.K6_SUPABASE_ANON_KEY || "";
const DOCTOR_EMAIL = __ENV.K6_DOCTOR_EMAIL || "";
const DOCTOR_PASSWORD = __ENV.K6_DOCTOR_PASSWORD || "";
const PATIENT_ID = __ENV.K6_PATIENT_ID || "";
const SERVICE_ID = __ENV.K6_SERVICE_ID || "";
const SLOT_ISO = __ENV.K6_SLOT_ISO || "";
/** "1" cancels the one appointment the test creates, in teardown(). */
const CLEANUP = __ENV.K6_CLEANUP === "1";

/** assert_slot_free(), migration 20260922180500_booking_rpcs.sql. */
const OVERLAP_MESSAGE = "El horario seleccionado acaba de ocuparse. Por favor elige otro.";
const RPC_TAG = "staff_create_appointment";

const bookingSuccess = new Counter("booking_success");
const bookingOverlapRefused = new Counter("booking_overlap_refused");
const bookingServerError = new Counter("booking_server_error");
const bookingUnexpected = new Counter("booking_unexpected");

// The 19 refusals are expected answers (400 + P0001), not failed requests.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 400));

export const options = {
  scenarios: {
    same_slot: {
      executor: "shared-iterations",
      vus: VUS,
      iterations: VUS,
      maxDuration: "1m",
    },
  },
  thresholds: {
    booking_success: ["count==1"],
    booking_overlap_refused: [`count==${VUS - 1}`],
    booking_server_error: ["count==0"],
    booking_unexpected: ["count==0"],
    [`http_req_duration{name:${RPC_TAG}}`]: ["p(95)<1500"],
  },
};

const requireEnv = () => {
  const missing = [
    ["K6_SUPABASE_URL", SUPABASE_URL],
    ["K6_SUPABASE_ANON_KEY", ANON_KEY],
    ["K6_DOCTOR_EMAIL", DOCTOR_EMAIL],
    ["K6_DOCTOR_PASSWORD", DOCTOR_PASSWORD],
    ["K6_PATIENT_ID", PATIENT_ID],
    ["K6_SERVICE_ID", SERVICE_ID],
    ["K6_SLOT_ISO", SLOT_ISO],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    exec.test.abort(`Missing environment variables: ${missing.join(", ")} (see load/README.md).`);
  }
  const slot = new Date(SLOT_ISO);
  if (Number.isNaN(slot.getTime()) || slot.getTime() <= Date.now()) {
    exec.test.abort("K6_SLOT_ISO must be a valid FUTURE instant, e.g. 2026-10-20T16:00:00Z.");
  }
};

const authHeaders = (token) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const parseJson = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

export function setup() {
  requireEnv();
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: DOCTOR_EMAIL, password: DOCTOR_PASSWORD }),
    {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      tags: { name: "auth_password_grant" },
    },
  );
  const session = res.status === 200 ? parseJson(res.body) : null;
  if (!session || typeof session.access_token !== "string") {
    // Only the status: the body may echo the email.
    exec.test.abort(`Doctor sign-in failed (HTTP ${res.status}).`);
  }
  return { token: session.access_token };
}

export default function (data) {
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/staff_create_appointment`,
    JSON.stringify({
      p_patient_id: PATIENT_ID,
      p_service_id: SERVICE_ID,
      p_start_time: SLOT_ISO,
    }),
    { headers: authHeaders(data.token), tags: { name: RPC_TAG } },
  );

  // Every counter gets a sample, so every threshold is evaluated.
  const ok = res.status >= 200 && res.status < 300;
  const serverError = res.status >= 500;
  const body = ok || serverError ? null : parseJson(res.body);
  const overlap = !!body && body.code === "P0001" && body.message === OVERLAP_MESSAGE;

  bookingSuccess.add(ok ? 1 : 0);
  bookingServerError.add(serverError ? 1 : 0);
  bookingOverlapRefused.add(overlap ? 1 : 0);
  bookingUnexpected.add(!ok && !serverError && !overlap ? 1 : 0);

  if (!ok && !serverError && !overlap) {
    console.warn(
      `Unexpected answer: HTTP ${res.status} ${body ? `${body.code}: ${body.message}` : ""}`,
    );
  }

  check(res, {
    "booked, or refused as overlapping": () => ok || overlap,
    "no 5xx": () => !serverError,
  });
}

export function teardown(data) {
  // The appointment that won the slot: its id is not secret.
  const query =
    `${SUPABASE_URL}/rest/v1/appointments?select=id,status` +
    `&patient_id=eq.${encodeURIComponent(PATIENT_ID)}` +
    `&start_time=eq.${encodeURIComponent(SLOT_ISO)}` +
    "&status=not.in.(cancelled,rejected)";
  const res = http.get(query, { headers: authHeaders(data.token), tags: { name: "teardown" } });
  const rows = res.status === 200 ? parseJson(res.body) || [] : [];
  if (rows.length === 0) {
    console.log("No live appointment found in the slot (nothing to clean up).");
    return;
  }
  for (const row of rows) {
    if (!CLEANUP) {
      console.log(
        `Created appointment ${row.id} (${row.status}). Cancel it in the calendar, rerun with K6_CLEANUP=1, or leave it for the pre-production reset.`,
      );
      continue;
    }
    const cancel = http.patch(
      `${SUPABASE_URL}/rest/v1/appointments?id=eq.${row.id}`,
      JSON.stringify({ status: "cancelled", cancel_reason: "k6: prueba de concurrencia" }),
      { headers: authHeaders(data.token), tags: { name: "teardown" } },
    );
    console.log(
      cancel.status >= 200 && cancel.status < 300
        ? `Cancelled appointment ${row.id}.`
        : `Could not cancel appointment ${row.id} (HTTP ${cancel.status}); cancel it in the calendar.`,
    );
  }
}

const metricCount = (data, name) => data.metrics[name]?.values?.count ?? 0;

const thresholdLines = (data) =>
  Object.entries(data.metrics)
    .filter(([, metric]) => metric.thresholds)
    .flatMap(([name, metric]) =>
      Object.entries(metric.thresholds).map(
        ([rule, result]) => `  ${result.ok ? "PASS" : "FAIL"}  ${name}  ${rule}`,
      ),
    );

export function handleSummary(data) {
  const latency = data.metrics[`http_req_duration{name:${RPC_TAG}}`]?.values ?? {};
  const fmt = (ms) => (typeof ms === "number" ? `${ms.toFixed(0)} ms` : "n/a");
  const lines = [
    "",
    "Booking concurrency: 20 simultaneous staff_create_appointment calls, one slot",
    `  slot                     ${SLOT_ISO}`,
    `  booked (2xx)             ${metricCount(data, "booking_success")}   (expected 1)`,
    `  refused, overlap P0001   ${metricCount(data, "booking_overlap_refused")}   (expected ${VUS - 1})`,
    `  server errors (5xx)      ${metricCount(data, "booking_server_error")}   (expected 0)`,
    `  other answers            ${metricCount(data, "booking_unexpected")}   (expected 0)`,
    `  latency p95 / max        ${fmt(latency["p(95)"])} / ${fmt(latency.max)}   (p95 limit 1500 ms)`,
    "",
    "Thresholds:",
    ...thresholdLines(data),
    "",
  ];
  return { stdout: lines.join("\n") };
}
