import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

export type AppRole = "doctor" | "patient" | "admin";

export interface AuthRoleState {
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  /**
   * True when the session exists but its role could not be READ (network,
   * server). Not the same as "not staff": show a retry, never a denial.
   */
  roleError: boolean;
  /** Reads the role of the current session again (after a roleError). */
  retryRole: () => void;
}

/**
 * Clinical staff: the doctor. Allowed into Centro Clínico (patients, agenda,
 * consultations, ARCO, Bitácora). Mirrors public.is_staff() in the database.
 */
export const isDoctorRole = (role: AppRole | null): boolean =>
  role === "doctor";

/**
 * Business staff: the doctor or an administrative account. Allowed into
 * Administración (catalog, inventory, finances) only. Mirrors
 * public.is_business_staff() in the database.
 */
export const isBusinessRole = (role: AppRole | null): boolean =>
  role === "doctor" || role === "admin";

/**
 * Any clinic staff account (doctor or admin), i.e. never a patient. Use it to
 * tell staff sessions apart from patient sessions; use isDoctorRole or
 * isBusinessRole to decide what a staff account may open.
 */
export const isStaffRole = (role: AppRole | null): boolean =>
  isBusinessRole(role);

/** `failed` = the read itself failed; a missing row is `{ role: null }`. */
const readRole = async (
  userId: string,
): Promise<{ role: AppRole | null; failed: boolean }> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[useAuthRole] Could not read the profile role:", error);
    return { role: null, failed: true };
  }

  return { role: (data?.role as AppRole | undefined) ?? null, failed: false };
};

/**
 * Single source of truth for "who is signed in and what may they do".
 *
 * The role always comes from the profiles table, never from the URL, from user
 * metadata or from anything else the client can influence. RLS only lets a user
 * read their own profile row, so this resolves to exactly one authoritative
 * answer per session.
 */
export const useAuthRole = (): AuthRoleState => {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleError, setRoleError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Last role read successfully, and for which user. A background re-read for
  // the same user (token refresh, tab focus) that fails keeps it instead of
  // throwing the doctor out of the screen she is working in.
  const lastKnown = useRef<{ userId: string; role: AppRole | null } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    const resolve = async (nextSession: Session | null) => {
      if (cancelled) return;

      setSession(nextSession);

      if (!nextSession?.user) {
        lastKnown.current = null;
        setRole(null);
        setRoleError(false);
        setLoading(false);
        return;
      }

      const userId = nextSession.user.id;
      const { role: nextRole, failed } = await readRole(userId);
      if (cancelled) return;

      const known = lastKnown.current;
      if (failed && known?.userId === userId) {
        // Failed background re-read: keep the last known role, no error.
        setRole(known.role);
        setRoleError(false);
        setLoading(false);
        return;
      }

      if (!failed) lastKnown.current = { userId, role: nextRole };
      else lastKnown.current = null;
      setRole(nextRole);
      setRoleError(failed);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => resolve(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Same user with a known role (e.g. a token refresh): re-read in the
      // background without the "checking access" screen. A different user
      // or a sign-out waits for the new answer.
      if (nextSession?.user?.id !== lastKnown.current?.userId) {
        setLoading(true);
      }
      void resolve(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [attempt]);

  const retryRole = useCallback(() => {
    setLoading(true);
    setRoleError(false);
    setAttempt((n) => n + 1);
  }, []);

  return { session, role, loading, roleError, retryRole };
};
