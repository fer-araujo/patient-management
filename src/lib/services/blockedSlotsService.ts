import { supabase } from "../supabase";
import { fetchAllRows } from "./fetchAllRows";
import {
  combineIsoDateAndTime,
  timeToDecimal,
} from "../../features/doctor/utils/calendarUtils";
import { CLINIC_TIME_ZONE } from "../clinicTime";

export interface DashboardBlockedSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  durationMins: number;
}

export const fetchBlockedSlots = async (): Promise<DashboardBlockedSlot[]> => {
  // Every block ever (one row per blocked day), paged past max_rows (1000).
  const { data, error } = await fetchAllRows((from, to) =>
    supabase
      .from("blocked_slots")
      .select("*")
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  if (error) {
    console.error("Error al obtener bloqueos:", error.message);
    throw new Error("No se pudieron cargar los horarios bloqueados.");
  }

  if (!data) return [];

  return data.map((slot) => {
    const start = new Date(slot.start_time);
    const end = new Date(slot.end_time);

    // FIX ANTI-MONSTRUOS: Calculamos duración.
    let durationMins = (end.getTime() - start.getTime()) / 60000;

    // Seguro de vida: Si por algún motivo en BD dura más de un día, lo topamos a 60 mins visualmente.
    if (durationMins > 1440) durationMins = 60;

    const formattedDate = start
      .toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: CLINIC_TIME_ZONE,
      })
      .replace(/\./g, "");
    const startTimeStr = start
      .toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: CLINIC_TIME_ZONE,
      })
      .toUpperCase();
    const endTimeStr = end
      .toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: CLINIC_TIME_ZONE,
      })
      .toUpperCase();

    return {
      id: slot.id,
      date: formattedDate,
      startTime: startTimeStr,
      endTime: endTimeStr,
      reason: slot.reason,
      durationMins,
    };
  });
};

/**
 * Returns a Spanish message when the block range is invalid, or null. Each day
 * of the range gets its own row from start time to end time, so the end time
 * must be later than the start time on every day, not only on the last one.
 */
export const validateBlockRange = (
  isoStartDate: string,
  startTimeStr: string,
  isoEndDate: string,
  endTimeStr: string,
): string | null => {
  if (!isoStartDate || !isoEndDate) return "Seleccione las fechas del bloqueo.";
  // ISO dates (YYYY-MM-DD) compare correctly as plain strings.
  if (isoEndDate < isoStartDate) {
    return "La fecha final no puede ser antes de la fecha inicial.";
  }
  if (timeToDecimal(endTimeStr) <= timeToDecimal(startTimeStr)) {
    return "La hora de fin debe ser después de la hora de inicio.";
  }
  return null;
};

const localDate = (isoDate: string): Date => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const createBlockedSlot = async (
  isoStartDate: string,
  startTimeStr: string,
  isoEndDate: string,
  endTimeStr: string,
  reason: string,
) => {
  const rangeError = validateBlockRange(
    isoStartDate,
    startTimeStr,
    isoEndDate,
    endTimeStr,
  );
  if (rangeError) throw new Error(rangeError);

  const start = localDate(isoStartDate);
  const end = localDate(isoEndDate);
  const inserts = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const currentIsoDate = `${y}-${m}-${day}`;

    inserts.push({
      start_time: combineIsoDateAndTime(currentIsoDate, startTimeStr),
      end_time: combineIsoDateAndTime(currentIsoDate, endTimeStr),
      reason,
    });
  }

  // An empty insert "succeeds" in PostgREST; never report a block that saved nothing.
  if (inserts.length === 0) throw new Error("No se pudo bloquear el horario.");

  const { error } = await supabase.from("blocked_slots").insert(inserts);
  if (error) throw new Error("No se pudo bloquear el horario.");
};

export const updateBlockedSlot = async (
  id: string,
  isoStartDate: string,
  startTimeStr: string,
  isoEndDate: string,
  endTimeStr: string,
  reason: string,
) => {
  // Validate before deleting, or an invalid edit would lose the original block.
  const rangeError = validateBlockRange(
    isoStartDate,
    startTimeStr,
    isoEndDate,
    endTimeStr,
  );
  if (rangeError) throw new Error(rangeError);

  await supabase.from("blocked_slots").delete().eq("id", id);
  await createBlockedSlot(
    isoStartDate,
    startTimeStr,
    isoEndDate,
    endTimeStr,
    reason,
  );
};

export const deleteBlockedSlot = async (id: string) => {
  const { error } = await supabase.from("blocked_slots").delete().eq("id", id);
  if (error) throw new Error("No se pudo desbloquear el horario.");
};
