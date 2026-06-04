import { useState, useEffect, type ReactNode } from "react";
import { CalendarContext } from "./CalendarContext";
import {
  fetchClinicSettings,
  DEFAULT_SCHEDULE,
  type WeeklySchedule,
} from "../../../lib/services/settingsService";

export const CalendarProvider = ({ children }: { children: ReactNode }) => {
  const [baseDate, setBaseDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<"day" | "week" | "month">(
    "week",
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
