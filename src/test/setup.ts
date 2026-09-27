import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { supabaseMock } from "./supabaseMock";
import { CLINIC_TIME_ZONE } from "./timezone";

// No test may ever talk to the real Supabase project.
vi.mock("../lib/supabase", async () => {
  const { supabaseMock: mock } = await import("./supabaseMock");
  return { supabase: mock.client };
});

// Fail loudly instead of producing wrong UTC conversions on another machine.
const activeTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (activeTimeZone !== CLINIC_TIME_ZONE) {
  throw new Error(
    `Tests must run in ${CLINIC_TIME_ZONE}, but the active time zone is ${activeTimeZone}. ` +
      "Check src/test/globalSetup.ts.",
  );
}

// jsdom has no scrollIntoView; the DatePicker year grid scrolls the current
// year into view when it opens.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom has no matchMedia; react-hot-toast's <Toaster> queries it on render.
// Reports "no match" for every query (e.g. prefers-reduced-motion: false).
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

afterEach(() => {
  cleanup();
  supabaseMock.reset();
  vi.useRealTimers();
});
