import { describe, expect, it } from "vitest";
import {
  CLINIC_TIME_ZONE,
  clinicIsoDate,
  clinicWallTimeToUtc,
  formatClinicShortDate,
  formatClinicTime12h,
  getZonedParts,
  nowInClinic,
  toClinicIsoDate,
} from "./clinicTime";

const CHICAGO = "America/Chicago";
const LOS_ANGELES = "America/Los_Angeles";

describe("clinicWallTimeToUtc", () => {
  it("reads 10:00 AM in Monterrey as 16:00Z in summer and in winter (no DST)", () => {
    expect(clinicWallTimeToUtc("2026-07-15", 10, 0).toISOString()).toBe(
      "2026-07-15T16:00:00.000Z",
    );
    expect(clinicWallTimeToUtc("2026-01-15", 10, 0).toISOString()).toBe(
      "2026-01-15T16:00:00.000Z",
    );
  });

  // The same algorithm applied to DST zones proves the offset is resolved per
  // instant through Intl, not hardcoded and not taken from the host.
  it.each([
    [CHICAGO, "2026-07-15", "2026-07-15T15:00:00.000Z"], // CDT, UTC-5
    [CHICAGO, "2026-01-15", "2026-01-15T16:00:00.000Z"], // CST, UTC-6
    [LOS_ANGELES, "2026-07-15", "2026-07-15T17:00:00.000Z"], // PDT, UTC-7
    [LOS_ANGELES, "2026-01-15", "2026-01-15T18:00:00.000Z"], // PST, UTC-8
  ])("resolves 10:00 AM in %s on %s to %s", (zone, isoDate, expected) => {
    expect(clinicWallTimeToUtc(isoDate, 10, 0, zone).toISOString()).toBe(expected);
  });

  it("uses the offset in force at the target time across a DST switch", () => {
    // US DST started on 2026-03-08 at 02:00 local. Midnight that day is still
    // CST; noon is already CDT.
    expect(clinicWallTimeToUtc("2026-03-08", 0, 0, CHICAGO).toISOString()).toBe(
      "2026-03-08T06:00:00.000Z",
    );
    expect(clinicWallTimeToUtc("2026-03-08", 12, 0, CHICAGO).toISOString()).toBe(
      "2026-03-08T17:00:00.000Z",
    );
  });

  it("rolls a late clinic evening into the next UTC day", () => {
    expect(clinicWallTimeToUtc("2026-12-31", 20, 0).toISOString()).toBe(
      "2027-01-01T02:00:00.000Z",
    );
  });
});

describe("clinic wall clock readings", () => {
  const instant = new Date("2026-07-16T01:30:00.000Z");

  it("reads the clinic's date and time, not UTC's nor another zone's", () => {
    expect(getZonedParts(instant)).toEqual({
      year: 2026,
      month: 7,
      day: 15,
      hours: 19,
      minutes: 30,
      seconds: 0,
    });
    expect(clinicIsoDate(instant)).toBe("2026-07-15");
    expect(formatClinicTime12h(instant)).toBe("07:30 PM");
    expect(formatClinicShortDate(instant)).toBe("15 jul 2026");

    expect(formatClinicTime12h(instant, CHICAGO)).toBe("08:30 PM");
    expect(formatClinicTime12h(instant, LOS_ANGELES)).toBe("06:30 PM");
  });

  it("formats midnight and noon in 12h form", () => {
    expect(formatClinicTime12h(new Date("2026-10-15T06:00:00.000Z"))).toBe("12:00 AM");
    expect(formatClinicTime12h(new Date("2026-10-15T18:00:00.000Z"))).toBe("12:00 PM");
  });

  it("gives the clinic's today and current time", () => {
    // 04:30Z on the 16th is still 10:30 PM on the 15th in Monterrey.
    const now = nowInClinic(new Date("2026-10-16T04:30:00.000Z"));
    expect(now.isoDate).toBe("2026-10-15");
    expect(now.hours).toBe(22);
    expect(now.minutes).toBe(30);

    expect(nowInClinic(new Date("2026-10-16T04:30:00.000Z"), CHICAGO).isoDate).toBe(
      "2026-10-15",
    );
  });

  it("turns a stored start_time into the clinic's calendar date", () => {
    // 08:00 PM on the 15th in Monterrey is already the 16th in UTC.
    expect(toClinicIsoDate("2026-10-16T02:00:00+00:00")).toBe("2026-10-15");
    expect(toClinicIsoDate("2026-10-15T16:00:00.000Z")).toBe("2026-10-15");
    // A date-only value is already a clinic date.
    expect(toClinicIsoDate("2026-10-15")).toBe("2026-10-15");
  });

  it("is anchored to America/Monterrey", () => {
    expect(CLINIC_TIME_ZONE).toBe("America/Monterrey");
  });
});
