import { afterEach, describe, expect, it, vi } from "vitest";
import {
  combineIsoDateAndTime,
  extractHoursMinutes,
  filterFutureTimesOnly,
  getAvailableTimeOptionsFromBusy,
  getSmartStartDate,
  hasAppointmentStarted,
  isTimeSlotInPast,
  isTimeStrInPast,
} from "./calendarUtils";
import { DEFAULT_SCHEDULE } from "../../../lib/services/settingsService";
import { CLINIC_TIME_ZONE, formatClinicTime12h } from "../../../lib/clinicTime";
import { fetchDoctorAppointments } from "../../../lib/services/clinicService";
import { fetchBlockedSlots } from "../../../lib/services/blockedSlotsService";
import { supabaseMock } from "../../../test/supabaseMock";
import { withBrowserTimeZone } from "../../../test/browserTimeZone";

/**
 * Patients may book from the USA. These tests run as if the browser were in a
 * US zone (see withBrowserTimeZone) and check that every clinic computation
 * still follows the Monterrey clock.
 */
// Note: switching process.env.TZ mid-run depends on the runtime (Node supports
// it); withBrowserTimeZone asserts the switch took effect before each run.

afterEach(() => {
  vi.useRealTimers();
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(CLINIC_TIME_ZONE);
});

const BROWSER_ZONES = [
  ["Chicago in summer (CDT)", "America/Chicago", "2026-07-16"],
  ["Chicago in winter (CST)", "America/Chicago", "2026-01-15"],
  ["Los Angeles in summer (PDT)", "America/Los_Angeles", "2026-07-16"],
  ["Los Angeles in winter (PST)", "America/Los_Angeles", "2026-01-15"],
] as const;

describe.each(BROWSER_ZONES)("a patient browsing from %s", (_, zone, isoDate) => {
  it("books 10:00 AM clinic time as 16:00Z", async () => {
    await withBrowserTimeZone(zone, () => {
      expect(combineIsoDateAndTime(isoDate, "10:00 AM")).toBe(`${isoDate}T16:00:00.000Z`);
    });
  });

  it("shows a 16:00Z appointment as 10:00 AM", async () => {
    await withBrowserTimeZone(zone, () => {
      expect(formatClinicTime12h(new Date(`${isoDate}T16:00:00.000Z`))).toBe("10:00 AM");
    });
  });

  it("offers the clinic's opening hours and hides slots busy in clinic time", async () => {
    await withBrowserTimeZone(zone, () => {
      // Busy 10:00-11:00 Monterrey time.
      const busy = [
        {
          start: new Date(`${isoDate}T16:00:00.000Z`),
          end: new Date(`${isoDate}T17:00:00.000Z`),
        },
      ];
      const options = getAvailableTimeOptionsFromBusy(isoDate, busy, DEFAULT_SCHEDULE, 30).map(
        (o) => o.value,
      );
      expect(options[0]).toBe("08:00 AM");
      expect(options.at(-1)).toBe("05:30 PM");
      expect(options).toContain("09:30 AM");
      expect(options).not.toContain("10:00 AM");
      expect(options).not.toContain("10:30 AM");
      expect(options).toContain("11:00 AM");
    });
  });

  it("filters past slots by the clinic's clock, not the browser's", async () => {
    await withBrowserTimeZone(zone, () => {
      vi.useFakeTimers();
      // 11:20 AM in Monterrey (17:20Z): 12:20 PM in Chicago summer, 09:20 AM
      // in Los Angeles summer.
      vi.setSystemTime(new Date(`${isoDate}T17:20:00.000Z`));

      const times = ["11:00 AM", "12:00 PM", "12:30 PM", "01:00 PM"];
      expect(filterFutureTimesOnly(times, isoDate)).toEqual(["12:30 PM", "01:00 PM"]);

      const [y, m, d] = isoDate.split("-").map(Number);
      const day = new Date(y, m - 1, d);
      expect(isTimeSlotInPast(day, 11, 15)).toBe(true);
      expect(isTimeSlotInPast(day, 11, 30)).toBe(false);
    });
  });

  it("uses the clinic's today near midnight", async () => {
    await withBrowserTimeZone(zone, () => {
      vi.useFakeTimers();
      // 05:30Z on the next day is still 11:30 PM on `isoDate` in Monterrey,
      // while it is already the next day in Chicago summer (00:30 AM).
      const next = new Date(`${isoDate}T12:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const nextIso = next.toISOString().slice(0, 10);
      vi.setSystemTime(new Date(`${nextIso}T05:30:00.000Z`));

      // Today (clinic) at 11:30 PM: nothing left that day.
      expect(filterFutureTimesOnly(["09:00 AM", "05:00 PM"], isoDate)).toEqual([]);
      // Tomorrow (clinic) is entirely in the future.
      expect(filterFutureTimesOnly(["09:00 AM"], nextIso)).toEqual(["09:00 AM"]);
    });
  });

  it("applies the 5 PM start-date cut-off on the clinic's clock", async () => {
    await withBrowserTimeZone(zone, () => {
      // 04:30 PM in Monterrey is 05:30 PM in Chicago summer: still today.
      expect(getSmartStartDate(DEFAULT_SCHEDULE, new Date(`${isoDate}T22:30:00.000Z`))).toBe(
        isoDate,
      );
    });
  });
});

describe("the doctor calendar in a Chicago summer browser", () => {
  const CHICAGO = "America/Chicago";
  const cell = new Date(2026, 6, 16); // Thursday 16 Jul 2026, a calendar cell

  it("labels a 15:30Z appointment 09:30 AM and agrees with the real instant on 'past'", async () => {
    supabaseMock.onFrom("appointments", {
      data: [
        {
          id: "a1",
          start_time: "2026-07-16T15:30:00.000Z",
          status: "confirmed",
          patient_id: "p1",
          reason: null,
          patients: { first_name: "Ana", last_name: "López", phone: "+525500000000" },
          services: { name: "Valoración", duration_mins: 30, price: 500 },
        },
      ],
    });

    await withBrowserTimeZone(CHICAGO, async () => {
      const [app] = await fetchDoctorAppointments();
      expect(app.date).toBe("16 jul 2026");
      expect(app.time).toBe("09:30 AM");

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-16T15:29:00.000Z"));
      expect(isTimeStrInPast(cell, app.time)).toBe(false);
      vi.setSystemTime(new Date("2026-07-16T15:30:00.000Z"));
      expect(isTimeStrInPast(cell, app.time)).toBe(true);
    });
  });

  it("labels blocked slots in clinic time too", async () => {
    supabaseMock.onFrom("blocked_slots", {
      data: [
        {
          id: "b1",
          start_time: "2026-07-16T15:30:00.000Z",
          end_time: "2026-07-16T16:00:00.000Z",
          reason: "comida",
        },
      ],
    });

    await withBrowserTimeZone(CHICAGO, async () => {
      const [block] = await fetchBlockedSlots();
      expect(block.date).toBe("16 jul 2026");
      expect(extractHoursMinutes(block.startTime)).toEqual({ hours: 9, minutes: 30 });
      expect(extractHoursMinutes(block.endTime)).toEqual({ hours: 10, minutes: 0 });
      expect(block.durationMins).toBe(30);
    });
  });
});

describe.each(BROWSER_ZONES)("hasAppointmentStarted from %s", (_, zone, isoDate) => {
  it("uses the clinic clock, not the browser's", async () => {
    await withBrowserTimeZone(zone, () => {
      const [y, m, d] = isoDate.split("-");
      const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      const app = { date: `${d} ${months[Number(m) - 1]} ${y}`, time: "10:00 AM" };
      // 10:00 AM Monterrey is 16:00Z, whatever zone the browser is in.
      const start = Date.parse(`${isoDate}T16:00:00.000Z`);
      expect(hasAppointmentStarted(app, start - 60_000)).toBe(false);
      expect(hasAppointmentStarted(app, start)).toBe(true);
    });
  });
});
