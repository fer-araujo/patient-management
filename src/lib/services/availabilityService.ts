import { supabase } from "../supabase";
import { fetchAllRows } from "./fetchAllRows";
import { DEFAULT_SCHEDULE, type WeeklySchedule } from "./settingsService";

/**
 * An opaque window in which the clinic cannot take a booking.
 *
 * This is everything a public visitor is told about the agenda: no patient, no
 * service, no block reason. It is produced by the get_availability RPC, which
 * is the only calendar surface granted to the anon role.
 */
export interface BusyRange {
  start: Date;
  end: Date;
}

interface RawBusyRange {
  start_time: string;
  end_time: string;
}

/** Busy windows between two instants, for the public booking screens. */
export const fetchPublicAvailability = async (
  from: Date,
  to: Date,
): Promise<BusyRange[]> => {
  // Up to 180 days of appointments and blocks: paged past max_rows (1000),
  // or later busy windows would look free. Identical ranges are
  // interchangeable, so start/end is a stable enough order.
  const { data, error } = await fetchAllRows<RawBusyRange>((first, last) =>
    supabase
      .rpc("get_availability", {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      })
      .order("start_time", { ascending: true })
      .order("end_time", { ascending: true })
      .range(first, last),
  );

  if (error) {
    console.error("[availabilityService] get_availability failed:", error);
    throw new Error("No se pudo consultar la disponibilidad de la agenda.");
  }

  return data.map((range) => ({
    start: new Date(range.start_time),
    end: new Date(range.end_time),
  }));
};

/**
 * Weekly opening hours for the public booking screens.
 *
 * clinic_settings is staff-only under the new RLS, so this goes through the
 * get_clinic_schedule RPC, which returns the schedule jsonb and nothing else.
 */
export const fetchPublicSchedule = async (): Promise<WeeklySchedule> => {
  const { data, error } = await supabase.rpc("get_clinic_schedule");

  if (error) {
    console.error("[availabilityService] get_clinic_schedule failed:", error);
    return DEFAULT_SCHEDULE;
  }

  const schedule = data as WeeklySchedule | null;
  if (!schedule || Object.keys(schedule).length === 0) {
    return DEFAULT_SCHEDULE;
  }

  return schedule;
};
