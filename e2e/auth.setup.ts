import { mkdir } from "node:fs/promises";
import { test as setup, expect } from "@playwright/test";
import {
  ADMIN_STATE,
  AUTH_DIR,
  DOCTOR_STATE,
  MISSING_ADMIN_CREDENTIALS,
  MISSING_DOCTOR_CREDENTIALS,
  adminCredentials,
  doctorCredentials,
} from "./support/env";
import { businessHeading, commandCenterHeading, signIn } from "./support/ui";

/**
 * Signs in ONCE per run through the real staff login and saves the session
 * (e2e/.auth/, gitignored) for every other project. Never signs out: in
 * Supabase a sign-out revokes the session the other projects reuse.
 */

setup("sign in as the doctor", async ({ page }) => {
  const credentials = doctorCredentials();
  setup.skip(credentials === null, MISSING_DOCTOR_CREDENTIALS);
  if (!credentials) return;

  await page.goto("/doctor/dashboard");
  await signIn(page, credentials);
  await expect(commandCenterHeading(page)).toBeVisible();

  await mkdir(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: DOCTOR_STATE });
});

setup("sign in as the admin", async ({ page }) => {
  const credentials = adminCredentials();
  setup.skip(credentials === null, MISSING_ADMIN_CREDENTIALS);
  if (!credentials) return;

  await page.goto("/doctor/admin");
  await signIn(page, credentials);
  await expect(businessHeading(page)).toBeVisible();

  await mkdir(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: ADMIN_STATE });
});
