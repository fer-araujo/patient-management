// File: lib/hooks/useJWTRefresh.ts
import { useEffect } from "react";
import { webAccount } from "@/lib/appwrite.config";

const COOKIE_NAME = `a_session_${process.env.NEXT_PUBLIC_PROJECT_ID}`;
const INTERVAL_MS = 1000 * 60 * 14; // cada 14 min

export function useJWTRefresh() {
  useEffect(() => {

    const refresh = async () => {
      try {
        // Pide JWT y reescribe la cookie
        const { jwt } = await webAccount.createJWT();
        document.cookie = [
          `${COOKIE_NAME}=${jwt}`,
          `Path=/`,
          `Max-Age=${15 * 60}`,
          `SameSite=Lax`,
          process.env.NODE_ENV === "production" ? "Secure" : "",
        ].filter(Boolean).join("; ");
      } catch {
        // Si falla, expulsa al login
        window.location.href = "/";
      }
    };

    // Primera vez + programa refresco
    refresh();
    const timer = setInterval(refresh, INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);
}
