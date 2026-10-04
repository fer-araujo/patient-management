import { CLINIC_TIME_ZONE } from "./timezone";

/**
 * Vitest global setup: runs in the main process before the test workers are
 * created. Workers inherit process.env, so every Date created in a test uses
 * the clinic's time zone regardless of the machine running the suite.
 */
export default function setup(): void {
  process.env.TZ = CLINIC_TIME_ZONE;
}
