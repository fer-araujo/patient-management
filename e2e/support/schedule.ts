/**
 * Finds a future day with two free whole-hour slots, in clinic time
 * (America/Monterrey), from the clinic's opening hours and the busy ranges
 * returned by get_availability. The staff calendar lists free times from the
 * same data, so a slot that is free here is offered there too.
 */

export const CLINIC_TIME_ZONE = "America/Monterrey";

export interface DaySchedule {
  isOpen: boolean;
  start: string;
  end: string;
}

/** Keyed by weekday, 0 = Sunday (the clinic_settings.schedule jsonb). */
export type WeeklySchedule = Record<string, DaySchedule | undefined>;

export interface BusyRange {
  start_time: string;
  end_time: string;
}

export interface Slot {
  /** Whole hour, 0-23, clinic time. */
  hour: number;
  /** As the calendar prints it: "10:00 AM". */
  label: string;
  /** The instant, for the API. */
  startUtc: string;
}

export interface DayPlan {
  /** YYYY-MM-DD, clinic time. */
  isoDate: string;
  /** Days after the clinic's today: how many times to press "Siguiente". */
  dayOffset: number;
  /** Where to book. */
  first: Slot;
  /** Where to reschedule to; never overlaps `first`. */
  second: Slot;
}

/** "08:30 AM" -> 8.5 */
export const timeToDecimal = (time: string): number => {
  const match = /^(\d{1,2}):(\d{2})\s*([AP])\.?\s*M\.?$/i.exec(time.trim());
  if (!match) throw new Error(`Unexpected schedule time: "${time}"`);
  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "P") hours += 12;
  return hours + Number(match[2]) / 60;
};

/** 13 -> "01:00 PM", the format of the calendar's slots and time lists. */
export const hourLabel = (hour: number): string =>
  `${String(hour % 12 || 12).padStart(2, "0")}:00 ${hour >= 12 ? "PM" : "AM"}`;

/** Today's date on the clinic's calendar, YYYY-MM-DD. */
export const clinicToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

export const addDays = (isoDate: string, days: number): string => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const weekdayOf = (isoDate: string): number => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** Minutes the clinic's wall clock is ahead of UTC at `instant` (negative). */
const clinicOffsetMinutes = (instant: Date): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
};

/** The instant of `hour`:00 on `isoDate`, clinic time. */
export const clinicInstant = (isoDate: string, hour: number): Date => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(y, m - 1, d, hour);
  const offset = clinicOffsetMinutes(new Date(wallClockAsUtc));
  return new Date(wallClockAsUtc - offset * 60_000);
};

const overlapsBusy = (busy: BusyRange[], start: number, end: number): boolean =>
  busy.some(
    (b) => new Date(b.start_time).getTime() < end && new Date(b.end_time).getTime() > start,
  );

/**
 * First open day, at least `minOffset` days ahead, with two non-overlapping
 * free whole-hour slots that fit `durationMins` inside the opening hours.
 * Whole hours only: the day view has one clickable cell per hour.
 */
export const planFreeDay = (
  schedule: WeeklySchedule,
  busy: BusyRange[],
  durationMins: number,
  today: string,
  { minOffset = 2, maxOffset = 60 }: { minOffset?: number; maxOffset?: number } = {},
): DayPlan => {
  for (let offset = minOffset; offset <= maxOffset; offset++) {
    const isoDate = addDays(today, offset);
    const day = schedule[String(weekdayOf(isoDate))];
    if (!day?.isOpen) continue;

    const startDec = timeToDecimal(day.start);
    const endDec = timeToDecimal(day.end);
    const free: Slot[] = [];
    // The day view only offers a cell for hours before the closing hour.
    for (let hour = Math.ceil(startDec); hour < Math.floor(endDec); hour++) {
      if (hour + durationMins / 60 > endDec) break;
      const start = clinicInstant(isoDate, hour);
      const end = start.getTime() + durationMins * 60_000;
      if (overlapsBusy(busy, start.getTime(), end)) continue;
      free.push({ hour, label: hourLabel(hour), startUtc: start.toISOString() });
    }

    const first = free[0];
    if (!first) continue;
    const second = free.find((s) => s.hour * 60 >= first.hour * 60 + durationMins);
    if (second) return { isoDate, dayOffset: offset, first, second };
  }
  throw new Error(
    `No open day with two free slots of ${durationMins} min in the next ${maxOffset} days.`,
  );
};
