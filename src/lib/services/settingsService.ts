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

// -----------------------------------------------------------------------------
// Doctor-only mode ("Modo solo doctora")
// -----------------------------------------------------------------------------

/** A stalled read of the mode fails after this long (then it is retried). */
export const CLINIC_MODE_TIMEOUT_MS = 8000;

const CLINIC_MODE_READ_ERROR = "No se pudo consultar el modo de la clínica.";

/**
 * True when the clinic works in doctor-only mode: no patient portal and no
 * online booking. Public (anon may call it), so the site can decide what to
 * show before anyone signs in. clinic_settings itself is staff-only.
 *
 * A read that does not answer within `timeoutMs` is aborted and fails like
 * any other error, so a hung request can never keep the app loading forever.
 */
export const fetchClinicMode = async (
  timeoutMs: number = CLINIC_MODE_TIMEOUT_MS,
): Promise<boolean> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });

  try {
    const { data, error } = await Promise.race([
      supabase.rpc("get_clinic_mode").abortSignal(controller.signal),
      timedOut,
    ]);
    if (error) {
      console.error("[settingsService] get_clinic_mode failed:", error.code);
      throw new Error(CLINIC_MODE_READ_ERROR);
    }
    return data === true;
  } catch (readError: unknown) {
    if (readError instanceof Error && readError.message === CLINIC_MODE_READ_ERROR) {
      throw readError;
    }
    console.error("[settingsService] get_clinic_mode did not answer:", readError);
    throw new Error(CLINIC_MODE_READ_ERROR);
  } finally {
    clearTimeout(timer);
  }
};

/** Turns doctor-only mode on or off (the doctor only). Returns the new mode. */
export const updateClinicMode = async (doctorOnly: boolean): Promise<boolean> => {
  const { data, error } = await supabase.rpc("set_clinic_mode", {
    p_doctor_only: doctorOnly,
  });
  if (error) {
    console.error("[settingsService] set_clinic_mode failed:", error.code);
    if (error.code === "42501") {
      throw new Error("No tienes permisos para cambiar el modo de la clínica.");
    }
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No se pudo cambiar el modo de la clínica.",
    );
  }
  return data === true;
};
