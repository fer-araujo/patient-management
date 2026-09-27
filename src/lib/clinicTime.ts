/**
 * Clinic wall-clock helpers.
 *
 * Three kinds of input, never to be mixed up:
 * - An INSTANT (`Date` from a timestamp, e.g. `new Date(start_time)`): an
 *   absolute point in time. Read it on the clinic clock with getZonedParts,
 *   clinicIsoDate, formatClinicTime12h or formatClinicShortDate; never with
 *   getHours()/getDate(), which use the browser's zone.
 * - A DATE-ONLY local `Date` (e.g. a calendar cell, `new Date(y, m, d)`): only
 *   its local year/month/day mean anything. Turn it into a clinic ISO date
 *   with localDateToIso.
 * - A CLINIC ISO DATE string ("YYYY-MM-DD"): a day on the clinic's calendar.
 *   Combine it with a clinic time through clinicWallTimeToUtc to get an
 *   instant.
 *
 * The clinic is in Monterrey, Mexico. Mexico abolished daylight saving time in
 * October 2022, so this zone is UTC-6 all year round. Patients may browse from
 * another zone (e.g. the USA, which does observe DST), so every opening hour,
 * slot, "today" and "now" must be read in the clinic's zone, never in the
 * browser's. The offset is always resolved through Intl rather than
 * hardcoded, so a future rule change in the tz database is picked up for free.
 */
export const CLINIC_TIME_ZONE = "America/Monterrey";

/** Shown next to every time a patient picks or sees. */
export const CLINIC_TIME_LABEL = "Horario de Monterrey";

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

const getPartsFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
};

/** The wall-clock reading of `instant` in `timeZone`. */
export const getZonedParts = (
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): ZonedParts => {
  const values: Record<string, number> = {};
  for (const part of getPartsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    // Some engines still report midnight as "24" even with h23.
    hours: values.hour % 24,
    minutes: values.minute,
    seconds: values.second,
  };
};

/** Milliseconds to add to UTC to get the wall clock of `timeZone` at `instant`. */
const zoneOffsetMs = (instant: number, timeZone: string): number => {
  const p = getZonedParts(new Date(instant), timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hours, p.minutes, p.seconds);
  return wallAsUtc - (instant - (((instant % 1000) + 1000) % 1000));
};

/**
 * The absolute instant at which the clock in `timeZone` reads
 * `isoDate` ("YYYY-MM-DD") `hours`:`minutes`. Independent of the browser zone.
 */
export const clinicWallTimeToUtc = (
  isoDate: string,
  hours: number,
  minutes: number,
  timeZone: string = CLINIC_TIME_ZONE,
): Date => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hours, minutes);
  // Two passes: the offset at the first guess may differ from the offset at
  // the real instant when a DST switch lies between them.
  const firstOffset = zoneOffsetMs(asUtc, timeZone);
  let result = asUtc - firstOffset;
  const secondOffset = zoneOffsetMs(result, timeZone);
  if (secondOffset !== firstOffset) result = asUtc - secondOffset;
  return new Date(result);
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for the calendar date `instant` falls on in `timeZone`. */
export const clinicIsoDate = (
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): string => {
  const p = getZonedParts(instant, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
};

/**
 * Clinic ISO date for a value that is either already "YYYY-MM-DD" (returned
 * as is) or a timestamp string (read on the clinic's calendar, not UTC's).
 */
export const toClinicIsoDate = (
  value: string,
  timeZone: string = CLINIC_TIME_ZONE,
): string => (value.includes("T") ? clinicIsoDate(new Date(value), timeZone) : value);

/** The clinic's current wall clock. */
export const nowInClinic = (
  now: Date = new Date(),
  timeZone: string = CLINIC_TIME_ZONE,
): ZonedParts & { isoDate: string } => {
  const parts = getZonedParts(now, timeZone);
  return {
    ...parts,
    isoDate: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
  };
};

/**
 * "YYYY-MM-DD" from the LOCAL components of a date-only Date (e.g. a calendar
 * cell built with `new Date(y, m, d)`), which carry no time zone meaning.
 */
export const localDateToIso = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** "hh:mm AM/PM" of `instant` on the clinic's wall clock. */
export const formatClinicTime12h = (
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): string => {
  const { hours, minutes } = getZonedParts(instant, timeZone);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${pad2(h12)}:${pad2(minutes)} ${ampm}`;
};

/** "15 oct 2026" of `instant` on the clinic's calendar. */
export const formatClinicShortDate = (
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): string =>
  instant
    .toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone,
    })
    .replace(/\./g, "");
