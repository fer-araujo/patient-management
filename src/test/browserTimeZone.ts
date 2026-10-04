import { expect } from "vitest";

/**
 * Runs `run` as if the browser were in `timeZone`: switches the process zone
 * (what `new Date(y, m, d, h)`, getHours() and toLocale* use by default) and
 * restores the clinic zone afterwards, so the global guard in src/test/setup.ts
 * still holds for every other test.
 *
 * Changing process.env.TZ at runtime depends on the JS runtime (Node resets
 * its zone cache on assignment); the first assertion self-checks that the
 * switch really took effect, so the test can never pass vacuously.
 */
export const withBrowserTimeZone = async (
  timeZone: string,
  run: () => void | Promise<void>,
): Promise<void> => {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timeZone);
    await run();
  } finally {
    process.env.TZ = previous;
  }
};
