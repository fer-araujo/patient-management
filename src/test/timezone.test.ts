import { describe, expect, it } from "vitest";
import { CLINIC_TIME_ZONE } from "./timezone";

describe("test environment time zone", () => {
  it("runs as if the machine were in Monterrey", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(CLINIC_TIME_ZONE);
    expect(process.env.TZ).toBe(CLINIC_TIME_ZONE);
  });

  it("is UTC-6 in both winter and summer (Mexico has no DST since 2022)", () => {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(360);
    expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(360);
  });
});
