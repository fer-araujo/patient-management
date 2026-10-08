import { defineConfig, devices } from "@playwright/test";
import { ADMIN_STATE, DOCTOR_STATE } from "./e2e/support/env";

/**
 * End-to-end suite against the app the owner runs (`npm run dev`); there is
 * no webServer here on purpose. See e2e/README.md before running it: it
 * writes test data to the configured Supabase project.
 */

const IPAD_UA = devices["iPad Pro 11"].userAgent;
const IPHONE_UA = devices["iPhone 15 Pro Max"].userAgent;

/** Every device project reuses the doctor session saved by the setup project. */
const doctorDevice = {
  dependencies: ["setup"],
  testIgnore: /admin\.spec\.ts$/,
};

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  // One worker, in order: the tests share one clinic calendar, and each one
  // looks for free slots right before booking.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    // The clinic's clock: the calendar and the slot search agree on "today".
    timezoneId: "America/Monterrey",
    locale: "es-MX",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop",
      ...doctorDevice,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: DOCTOR_STATE,
      },
    },
    {
      name: "ipad",
      ...doctorDevice,
      use: {
        browserName: "webkit",
        userAgent: IPAD_UA,
        viewport: { width: 834, height: 1194 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: false,
        storageState: DOCTOR_STATE,
      },
    },
    {
      name: "ipad-landscape",
      ...doctorDevice,
      use: {
        browserName: "webkit",
        userAgent: IPAD_UA,
        viewport: { width: 1194, height: 834 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: false,
        storageState: DOCTOR_STATE,
      },
    },
    {
      name: "iphone",
      ...doctorDevice,
      use: {
        browserName: "webkit",
        userAgent: IPHONE_UA,
        viewport: { width: 440, height: 956 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
        storageState: DOCTOR_STATE,
      },
    },
    {
      name: "admin",
      dependencies: ["setup"],
      testMatch: /admin\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: ADMIN_STATE,
      },
    },
  ],
});
