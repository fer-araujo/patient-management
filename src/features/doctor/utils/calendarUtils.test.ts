import { afterEach, describe, expect, it, vi } from "vitest";
import {
  combineIsoDateAndTime,
  combineVisualDateAndTime,
  extractHoursMinutes,
  filterFutureTimesOnly,
  getAvailableTimeOptions,
  getAvailableTimeOptionsFromBusy,
  getGridHoursRange,
  getServiceColors,
  isTimeSlotInPast,
  parseHour24,
  parseVisualDateToISO,
  timeToDecimal,
  timeToPixels,
  HOUR_HEIGHT,
} from "./calendarUtils";
import {
  DEFAULT_SCHEDULE,
  type WeeklySchedule,
} from "../../../lib/services/settingsService";
import type { DashboardAppointment } from "../../../lib/services/clinicService";
import type { DashboardBlockedSlot } from "../../../lib/services/blockedSlotsService";

// 2026-10-15 is a Thursday (clinic open 08:00 AM - 06:00 PM by default).
const THURSDAY = "2026-10-15";

afterEach(() => {
  vi.useRealTimers();
});

describe("extractHoursMinutes", () => {
  it.each([
    ["08:00 AM", 8, 0],
    ["10:30 AM", 10, 30],
    ["01:15 PM", 13, 15],
    ["11:45 PM", 23, 45],
    ["12:00 PM", 12, 0],
    ["12:30 PM", 12, 30],
    ["12:00 AM", 0, 0],
    ["12:45 AM", 0, 45],
    ["12:30 a.m.", 0, 30],
    ["3:05 p. m.", 15, 5],
    ["14:00", 14, 0],
    ["9 AM", 9, 0],
  ])("parses %s as %i:%i", (input, hours, minutes) => {
    expect(extractHoursMinutes(input)).toEqual({ hours, minutes });
  });

  it("derives the 24h hour, decimal time and pixel offset from the same parse", () => {
    expect(parseHour24("12:00 AM")).toBe(0);
    expect(parseHour24("06:00 PM")).toBe(18);
    expect(timeToDecimal("09:45 AM")).toBe(9.75);
    expect(timeToPixels("10:30 AM", 8)).toBe(2.5 * HOUR_HEIGHT);
  });
});

describe("combineIsoDateAndTime (clinic-local time to UTC)", () => {
  it("converts a Monterrey morning time to UTC (+6h)", () => {
    expect(combineIsoDateAndTime(THURSDAY, "10:30 AM")).toBe(
      "2026-10-15T16:30:00.000Z",
    );
  });

  it("treats 12:00 PM as noon", () => {
    expect(combineIsoDateAndTime(THURSDAY, "12:00 PM")).toBe(
      "2026-10-15T18:00:00.000Z",
    );
  });

  it("treats 12:00 AM as midnight at the START of the same day", () => {
    expect(combineIsoDateAndTime(THURSDAY, "12:00 AM")).toBe(
      "2026-10-15T06:00:00.000Z",
    );
  });

  it("rolls late-evening local times into the next UTC day", () => {
    expect(combineIsoDateAndTime(THURSDAY, "11:45 PM")).toBe(
      "2026-10-16T05:45:00.000Z",
    );
  });

  it("uses the same UTC-6 offset in winter and summer (no DST in Mexico)", () => {
    expect(combineIsoDateAndTime("2026-01-15", "09:00 AM")).toBe(
      "2026-01-15T15:00:00.000Z",
    );
    expect(combineIsoDateAndTime("2026-07-15", "09:00 AM")).toBe(
      "2026-07-15T15:00:00.000Z",
    );
  });

  it("does not skip or shift the hour on the old DST switch dates", () => {
    // First Sunday of April and last Sunday of October: the former Mexican
    // DST transitions. 02:30 AM would not have existed under the old rules.
    expect(combineIsoDateAndTime("2026-04-05", "02:30 AM")).toBe(
      "2026-04-05T08:30:00.000Z",
    );
    expect(combineIsoDateAndTime("2026-10-25", "01:30 AM")).toBe(
      "2026-10-25T07:30:00.000Z",
    );
  });

  it("handles month and year boundaries", () => {
    expect(combineIsoDateAndTime("2026-12-31", "08:00 PM")).toBe(
      "2027-01-01T02:00:00.000Z",
    );
  });
});

describe("parseVisualDateToISO / combineVisualDateAndTime", () => {
  it("parses the short Spanish date used by the staff calendar", () => {
    expect(parseVisualDateToISO("5 oct 2026")).toBe("2026-10-05");
    expect(parseVisualDateToISO("15 Dic 2026")).toBe("2026-12-15");
    expect(parseVisualDateToISO("01 ene 2027")).toBe("2027-01-01");
  });

  it("falls back to January for an unknown month abbreviation", () => {
    expect(parseVisualDateToISO("10 xyz 2026")).toBe("2026-01-10");
  });

  it("combines a visual date and a 12h time into a UTC instant", () => {
    expect(combineVisualDateAndTime("05 oct 2026", "03:00 PM")).toBe(
      "2026-10-05T21:00:00.000Z",
    );
  });
});

describe("getServiceColors", () => {
  it("picks a color family by service name and dims past appointments", () => {
    expect(getServiceColors("Toxina botulínica", false)).toContain("bg-blue-50");
    expect(getServiceColors("Hilos tensores", false)).toContain("bg-emerald-50");
    expect(getServiceColors("Plasma rico", false)).toContain("bg-rose-50");
    expect(getServiceColors("Valoración inicial", false)).toContain("bg-indigo-50");
    expect(getServiceColors("Otro", false)).toContain("bg-amber-50");
    expect(getServiceColors("Otro", true)).toContain("opacity-60");
    expect(getServiceColors("Otro", false)).not.toContain("opacity-60");
  });
});

describe("getGridHoursRange", () => {
  it("spans from the earliest opening to the latest closing hour", () => {
    expect(getGridHoursRange(DEFAULT_SCHEDULE)).toEqual({ start: 8, end: 18 });
  });

  it("falls back to 8-18 when no day is open", () => {
    const closed: WeeklySchedule = Object.fromEntries(
      Object.entries(DEFAULT_SCHEDULE).map(([day, s]) => [day, { ...s, isOpen: false }]),
    );
    expect(getGridHoursRange(closed)).toEqual({ start: 8, end: 18 });
  });
});

describe("getAvailableTimeOptionsFromBusy (public booking)", () => {
  const values = (options: { value: string }[]) => options.map((o) => o.value);

  it("offers 15-minute slots within opening hours that fit the duration", () => {
    const options = values(
      getAvailableTimeOptionsFromBusy(THURSDAY, [], DEFAULT_SCHEDULE, 30),
    );
    expect(options[0]).toBe("08:00 AM");
    expect(options).toContain("12:00 PM");
    // A 30-minute visit must end by 06:00 PM.
    expect(options.at(-1)).toBe("05:30 PM");
    expect(options).not.toContain("05:45 PM");
  });

  it("returns nothing on a closed day or without a date", () => {
    // 2026-10-18 is a Sunday.
    expect(getAvailableTimeOptionsFromBusy("2026-10-18", [], DEFAULT_SCHEDULE)).toEqual([]);
    expect(getAvailableTimeOptionsFromBusy("", [], DEFAULT_SCHEDULE)).toEqual([]);
  });

  it("removes every slot that overlaps a busy range given in UTC", () => {
    // Busy 10:00-11:00 Monterrey time = 16:00-17:00 UTC.
    const busy = [
      {
        start: new Date("2026-10-15T16:00:00.000Z"),
        end: new Date("2026-10-15T17:00:00.000Z"),
      },
    ];
    const options = values(
      getAvailableTimeOptionsFromBusy(THURSDAY, busy, DEFAULT_SCHEDULE, 30),
    );
    expect(options).toContain("09:30 AM"); // ends exactly at 10:00
    expect(options).not.toContain("09:45 AM");
    expect(options).not.toContain("10:00 AM");
    expect(options).not.toContain("10:45 AM");
    expect(options).toContain("11:00 AM"); // starts exactly at 11:00
  });
});

describe("getAvailableTimeOptions (staff calendar)", () => {
  const appointment = (over: Partial<DashboardAppointment>): DashboardAppointment => ({
    id: "a1",
    patientId: "p1",
    patientName: "Paciente",
    service: "Valoración",
    date: "15 oct 2026",
    time: "10:00 AM",
    phone: "+525500000000",
    isNewPatient: false,
    status: "confirmed",
    durationMins: 60,
    reason: null,
    ...over,
  });

  it("blocks slots taken by confirmed appointments and blocked slots on that day", () => {
    const blocks: DashboardBlockedSlot[] = [
      {
        id: "b1",
        date: "15 oct 2026",
        startTime: "02:00 PM",
        endTime: "02:30 PM",
        reason: "comida",
        durationMins: 30,
      },
    ];
    const options = getAvailableTimeOptions(
      THURSDAY,
      [appointment({})],
      blocks,
      DEFAULT_SCHEDULE,
      30,
    ).map((o) => o.value);

    expect(options).toContain("09:30 AM");
    expect(options).not.toContain("10:00 AM");
    expect(options).not.toContain("10:30 AM");
    expect(options).toContain("11:00 AM");
    expect(options).not.toContain("02:00 PM");
    expect(options).toContain("02:30 PM");
  });

  it("ignores pending appointments and appointments on other days", () => {
    const options = getAvailableTimeOptions(
      THURSDAY,
      [appointment({ status: "pending" }), appointment({ date: "16 oct 2026" })],
      [],
      DEFAULT_SCHEDULE,
      30,
    ).map((o) => o.value);
    expect(options).toContain("10:00 AM");
  });
});

describe("isTimeSlotInPast / filterFutureTimesOnly", () => {
  it("marks earlier days and elapsed hours of today as past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 11, 20)); // 11:20 AM local

    expect(isTimeSlotInPast(new Date(2026, 9, 14), 17)).toBe(true);
    expect(isTimeSlotInPast(new Date(2026, 9, 15), 11)).toBe(true);
    expect(isTimeSlotInPast(new Date(2026, 9, 15), 12)).toBe(false);
    expect(isTimeSlotInPast(new Date(2026, 9, 16), 8)).toBe(false);
  });

  it("keeps only times at least one hour ahead when the date is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 11, 20));

    const times = ["11:00 AM", "12:00 PM", "12:30 PM", "01:00 PM"];
    expect(filterFutureTimesOnly(times, THURSDAY)).toEqual(["12:30 PM", "01:00 PM"]);
    expect(filterFutureTimesOnly(times, "2026-10-16")).toEqual(times);
  });
});
