import { useState, useEffect, type ReactNode } from "react";
import { CalendarContext } from "./CalendarContext";
import { PHONE_MEDIA_QUERY } from "../../../components/ui/useIsPhone";
import {
  fetchClinicSettings,
  DEFAULT_SCHEDULE,
  type WeeklySchedule,
} from "../../../lib/services/settingsService";

export const CalendarProvider = ({ children }: { children: ReactNode }) => {
  const [baseDate, setBaseDate] = useState(new Date());
  // Phones open on Día (they have no Semana view); the doctor's later choice
  // is kept for as long as the dashboard is open.
  const [calendarView, setCalendarView] = useState<"day" | "week" | "month">(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.(PHONE_MEDIA_QUERY).matches
        ? "day"
        : "week",
  );
  const [workingSchedule, setWorkingSchedule] =
    useState<WeeklySchedule>(DEFAULT_SCHEDULE); // <-- CAMBIO AQUÍ

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const schedule = await fetchClinicSettings();
        setWorkingSchedule(schedule);
      } catch (error) {
        console.error("Error al cargar configuraciones:", error);
      }
    };
    loadSettings();
  }, []);

  return (
    <CalendarContext.Provider
      value={{
        baseDate,
        setBaseDate,
        calendarView,
        setCalendarView,
        workingSchedule,
        setWorkingSchedule,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
};
