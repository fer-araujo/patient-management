// Read-only smoke load of the public booking screen (see load/README.md).
//
// 10 virtual users for 30 s, as an anonymous visitor (anon key only), call
// what the booking calendar calls: get_availability for the next 30 days and
// get_clinic_schedule. Writes nothing.

import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";

const SUPABASE_URL = (__ENV.K6_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = __ENV.K6_SUPABASE_ANON_KEY || "";

export const options = {
  scenarios: {
    public_booking_reads: {
      executor: "constant-vus",
      vus: 10,
      duration: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
    checks: ["rate>0.99"],
  },
};

// Anonymous: the apikey header alone, like a visitor who is not signed in.
const headers = { apikey: ANON_KEY, "Content-Type": "application/json" };

export function setup() {
  if (!SUPABASE_URL || !ANON_KEY) {
    exec.test.abort("Set K6_SUPABASE_URL and K6_SUPABASE_ANON_KEY (see load/README.md).");
  }
}

export default function () {
  const from = new Date();
  const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);

  const availability = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_availability`,
    JSON.stringify({ p_from: from.toISOString(), p_to: to.toISOString() }),
    { headers, tags: { name: "get_availability" } },
  );
  check(availability, {
    "get_availability 200": (r) => r.status === 200,
    "get_availability returns a list": (r) => Array.isArray(r.json()),
  });

  const schedule = http.post(`${SUPABASE_URL}/rest/v1/rpc/get_clinic_schedule`, "{}", {
    headers,
    tags: { name: "get_clinic_schedule" },
  });
  check(schedule, {
    "get_clinic_schedule 200": (r) => r.status === 200,
    "get_clinic_schedule returns the week": (r) => {
      const week = r.json();
      return !!week && typeof week === "object" && !Array.isArray(week);
    },
  });

  sleep(1);
}

const thresholdLines = (data) =>
  Object.entries(data.metrics)
    .filter(([, metric]) => metric.thresholds)
    .flatMap(([name, metric]) =>
      Object.entries(metric.thresholds).map(
        ([rule, result]) => `  ${result.ok ? "PASS" : "FAIL"}  ${name}  ${rule}`,
      ),
    );

export function handleSummary(data) {
  const duration = data.metrics.http_req_duration?.values ?? {};
  const failed = data.metrics.http_req_failed?.values?.rate ?? 0;
  const requests = data.metrics.http_reqs?.values?.count ?? 0;
  const fmt = (ms) => (typeof ms === "number" ? `${ms.toFixed(0)} ms` : "n/a");
  const lines = [
    "",
    "Public booking smoke: 10 VUs x 30 s, get_availability + get_clinic_schedule (anon)",
    `  requests                 ${requests}`,
    `  failed requests          ${(failed * 100).toFixed(2)} %   (limit < 1 %)`,
    `  latency p95 / max        ${fmt(duration["p(95)"])} / ${fmt(duration.max)}   (p95 limit 800 ms)`,
    "",
    "Thresholds:",
    ...thresholdLines(data),
    "",
  ];
  return { stdout: lines.join("\n") };
}
