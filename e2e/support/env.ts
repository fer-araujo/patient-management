import { fileURLToPath } from "node:url";

/**
 * Credentials and paths for the e2e suite. Credentials come ONLY from the
 * environment and are never logged or written anywhere except the
 * storageState files under e2e/.auth/ (gitignored).
 */

export interface Credentials {
  email: string;
  password: string;
}

const fromEnv = (emailVar: string, passwordVar: string): Credentials | null => {
  const email = process.env[emailVar]?.trim();
  const password = process.env[passwordVar];
  return email && password ? { email, password } : null;
};

export const doctorCredentials = (): Credentials | null =>
  fromEnv("E2E_DOCTOR_EMAIL", "E2E_DOCTOR_PASSWORD");

export const adminCredentials = (): Credentials | null =>
  fromEnv("E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD");

export const hasDoctorCredentials = (): boolean => doctorCredentials() !== null;
export const hasAdminCredentials = (): boolean => adminCredentials() !== null;

export const MISSING_DOCTOR_CREDENTIALS =
  "Set E2E_DOCTOR_EMAIL and E2E_DOCTOR_PASSWORD to run the doctor e2e tests (see e2e/README.md).";
export const MISSING_ADMIN_CREDENTIALS =
  "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the admin e2e tests (see e2e/README.md).";

/** Signed-in browser state saved by auth.setup.ts (gitignored). */
export const AUTH_DIR = fileURLToPath(new URL("../.auth/", import.meta.url));
export const DOCTOR_STATE = `${AUTH_DIR}doctor.json`;
export const ADMIN_STATE = `${AUTH_DIR}admin.json`;
