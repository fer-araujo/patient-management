import { supabase } from "../supabase";

export type DaySchedule = { isOpen: boolean; start: string; end: string };
export type WeeklySchedule = Record<number, DaySchedule>;

export const DEFAULT_SCHEDULE: WeeklySchedule = {
  1: { isOpen: true, start: "08:00 AM", end: "06:00 PM" }, // Lunes
  2: { isOpen: true, start: "08:00 AM", end: "06:00 PM" }, // Martes
  3: { isOpen: true, start: "08:00 AM", end: "06:00 PM" }, // Miércoles
  4: { isOpen: true, start: "08:00 AM", end: "06:00 PM" }, // Jueves
  5: { isOpen: true, start: "08:00 AM", end: "06:00 PM" }, // Viernes
  6: { isOpen: true, start: "09:00 AM", end: "02:00 PM" }, // Sábado
  0: { isOpen: false, start: "09:00 AM", end: "06:00 PM" }, // Domingo
};

export const fetchClinicSettings = async (): Promise<WeeklySchedule> => {
  const { data, error } = await supabase
    .from("clinic_settings")
    .select("schedule")
    .limit(1)
    .single();
  if (error || !data?.schedule) return DEFAULT_SCHEDULE;
  return data.schedule as WeeklySchedule;
};

export const updateClinicSettings = async (
  schedule: WeeklySchedule,
): Promise<void> => {
  const { data: current } = await supabase
    .from("clinic_settings")
    .select("id")
    .limit(1)
    .single();
  if (current) {
    const { error } = await supabase
      .from("clinic_settings")
      .update({ schedule })
      .eq("id", current.id);
    if (error) throw new Error("Error al actualizar el horario.");
  } else {
    const { error } = await supabase
      .from("clinic_settings")
      .insert({ schedule });
    if (error) throw new Error("Error al crear el horario.");
  }
};
