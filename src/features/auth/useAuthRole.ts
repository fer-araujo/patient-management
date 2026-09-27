import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

export type AppRole = "doctor" | "patient" | "admin";

export interface AuthRoleState {
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
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

const readRole = async (userId: string): Promise<AppRole | null> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[useAuthRole] Could not read the profile role:", error);
    return null;
  }

  return (data?.role as AppRole | undefined) ?? null;
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

  useEffect(() => {
    let cancelled = false;

    const resolve = async (nextSession: Session | null) => {
      if (cancelled) return;

      setSession(nextSession);

      if (!nextSession?.user) {
        setRole(null);
        setLoading(false);
        return;
      }

      const nextRole = await readRole(nextSession.user.id);
      if (cancelled) return;

      setRole(nextRole);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => resolve(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setLoading(true);
      void resolve(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { session, role, loading };
};
