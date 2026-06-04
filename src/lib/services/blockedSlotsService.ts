import { supabase } from "../supabase";
import { combineIsoDateAndTime } from "../../features/doctor/utils/calendarUtils";

export interface DashboardBlockedSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  durationMins: number;
}

export const fetchBlockedSlots = async (): Promise<DashboardBlockedSlot[]> => {
  const { data, error } = await supabase.from("blocked_slots").select("*");

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
      })
      .replace(/\./g, "");
    const startTimeStr = start
      .toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
      .toUpperCase();
    const endTimeStr = end
      .toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
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

export const createBlockedSlot = async (
  isoStartDate: string,
  startTimeStr: string,
  isoEndDate: string,
  endTimeStr: string,
  reason: string,
) => {
  const start = new Date(`${isoStartDate}T00:00:00`);
  const end = new Date(`${isoEndDate}T00:00:00`);
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
