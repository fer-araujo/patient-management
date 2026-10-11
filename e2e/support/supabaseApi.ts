import type { APIRequestContext, Page } from "@playwright/test";
import { loadEnv } from "vite";
import {
  addDays,
  clinicToday,
  planFreeDay,
  type BusyRange,
  type DayPlan,
  type WeeklySchedule,
} from "./schedule";

/**
 * Direct Supabase calls made AS THE SIGNED-IN DOCTOR (same token, same RLS
 * and RPC checks as the app). Used only to pick a bookable service and to find
 * free slots; every booking goes through the calendar UI. The access token is
 * read from the page and never logged; error messages carry the path and the
 * response body only.
 */

interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY when set, otherwise the
 * VITE_SUPABASE_* values the dev server reads from the .env files (the anon
 * key is public by design).
 */
const supabaseConfig = (): SupabaseConfig => {
  const fileEnv = loadEnv(process.env.E2E_VITE_MODE ?? "development", process.cwd(), "VITE_");
  const url = process.env.E2E_SUPABASE_URL ?? fileEnv.VITE_SUPABASE_URL;
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY ?? fileEnv.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase URL/anon key not found: keep VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env or set E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY.",
    );
  }
  return { url: url.replace(/\/+$/, ""), anonKey };
};

/** The doctor's access token, from supabase-js' session in localStorage. */
const accessTokenOf = async (page: Page): Promise<string> => {
  const token = await page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const session = JSON.parse(window.localStorage.getItem(key) ?? "null");
        if (typeof session?.access_token === "string") return session.access_token as string;
      } catch {
        // Not a session entry.
      }
    }
    return null;
  });
  if (!token) {
    throw new Error("No Supabase session in the page. Open the app signed in first.");
  }
  return token;
};

export interface BookableService {
  id: string;
  name: string;
  duration_mins: number;
}

export interface ClinicApi {
  bookableService(): Promise<BookableService>;
  planFreeDay(durationMins: number): Promise<DayPlan>;
}

/** API helpers bound to the session of `page` (which must be on the app). */
export const clinicApiFor = async (page: Page): Promise<ClinicApi> => {
  const config = supabaseConfig();
  const token = await accessTokenOf(page);
  const request: APIRequestContext = page.request;

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await request.fetch(`${config.url}${path}`, {
      method,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      data: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok()) {
      throw new Error(
        `Supabase ${method} ${path.split("?")[0]} failed (${response.status()}): ${text}`,
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  };

  return {
    async bookableService() {
      // The shortest active service: easiest to fit twice in one day.
      const rows = await call<BookableService[]>(
        "GET",
        "/rest/v1/services?select=id,name,duration_mins&is_active=eq.true&duration_mins=not.is.null&duration_mins=lte.120&order=duration_mins.asc,name.asc&limit=1",
      );
      if (rows.length === 0) {
        throw new Error("The catalog has no active service of 2 hours or less to book.");
      }
      return rows[0];
    },

    async planFreeDay(durationMins) {
      const today = clinicToday();
      const schedule = await call<WeeklySchedule>("POST", "/rest/v1/rpc/get_clinic_schedule", {});
      // One call for the whole search window (the RPC caps it at 180 days).
      const busy = await call<BusyRange[]>("POST", "/rest/v1/rpc/get_availability", {
        p_from: new Date(`${today}T00:00:00Z`).toISOString(),
        p_to: new Date(`${addDays(today, 63)}T00:00:00Z`).toISOString(),
      });
      return planFreeDay(schedule, busy, durationMins, today);
    },
  };
};
