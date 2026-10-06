import { createContext } from "react";
import { updateClinicMode } from "../../lib/services/settingsService";

/** Extra attempts after a failed read of the mode, and the pause before each. */
export const CLINIC_MODE_RETRIES = 2;
export const CLINIC_MODE_RETRY_DELAY_MS = 600;

export interface ClinicModeState {
  /**
   * "Modo solo doctora": no patient portal and no online booking; patients
   * only receive informational WhatsApp messages. False while unknown.
   */
  doctorOnlyMode: boolean;
  /** True until the mode was read once from the server (retries included). */
  loading: boolean;
  /**
   * True when the mode could not be read (after the retries). The app then
   * behaves as the normal mode, but the doctor's switch must not claim
   * "Desactivado": it offers to read the mode again.
   */
  error: boolean;
  /** Reads the mode again (after a failed read). */
  retry: () => void;
  /** Changes the mode on the server (the doctor only) and for the whole app. */
  setDoctorOnlyMode: (doctorOnly: boolean) => Promise<void>;
}

/**
 * Outside a ClinicModeProvider (e.g. a component rendered alone in a test)
 * the app behaves as before the mode existed: portal and booking open.
 */
export const DEFAULT_CLINIC_MODE: ClinicModeState = {
  doctorOnlyMode: false,
  loading: false,
  error: false,
  retry: () => {},
  setDoctorOnlyMode: async (doctorOnly) => {
    await updateClinicMode(doctorOnly);
  },
};

export const ClinicModeContext = createContext<ClinicModeState>(DEFAULT_CLINIC_MODE);
