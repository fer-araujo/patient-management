import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

export type AppRole = "doctor" | "patient" | "admin";

export interface AuthRoleState {
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
}

/** Clinic staff: allowed into the /doctor area. */
export const isStaffRole = (role: AppRole | null): boolean =>
  role === "doctor" || role === "admin";

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
