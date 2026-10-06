import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CLINIC_MODE_RETRIES,
  CLINIC_MODE_RETRY_DELAY_MS,
  ClinicModeContext,
} from "./clinicModeContext";
import {
  fetchClinicMode,
  updateClinicMode,
} from "../../lib/services/settingsService";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the clinic's doctor-only mode (public RPC, no sign-in needed) and
 * shares it with the whole app. A failed read is retried twice after a short
 * pause; if it still fails, `error` is set and `retry()` reads it again.
 *
 * While the mode is unknown the app falls back to the normal mode (portal
 * open). That is safe: the database itself refuses every patient action while
 * the mode is on, with a message telling the patient to call the clinic.
 */
export const ClinicModeProvider = ({
  children,
  retryDelayMs = CLINIC_MODE_RETRY_DELAY_MS,
}: {
  children: ReactNode;
  /** Pause before each retry; tests pass 0. */
  retryDelayMs?: number;
}) => {
  const [doctorOnlyMode, setMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    const read = async () => {
      for (let tryNumber = 0; tryNumber <= CLINIC_MODE_RETRIES; tryNumber += 1) {
        if (tryNumber > 0) await wait(retryDelayMs);
        if (!active) return;
        try {
          const mode = await fetchClinicMode();
          if (!active) return;
          setMode(mode);
          setError(false);
          setLoading(false);
          return;
        } catch (readError: unknown) {
          console.error("[ClinicModeProvider] Could not read the clinic mode:", readError);
        }
      }
      if (!active) return;
      setError(true);
      setLoading(false);
    };

    void read();
    return () => {
      active = false;
    };
  }, [attempt, retryDelayMs]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(false);
    setAttempt((n) => n + 1);
  }, []);

  const setDoctorOnlyMode = useCallback(async (doctorOnly: boolean) => {
    setMode(await updateClinicMode(doctorOnly));
    setError(false);
  }, []);

  const value = useMemo(
    () => ({ doctorOnlyMode, loading, error, retry, setDoctorOnlyMode }),
    [doctorOnlyMode, loading, error, retry, setDoctorOnlyMode],
  );

  return (
    <ClinicModeContext.Provider value={value}>{children}</ClinicModeContext.Provider>
  );
};
