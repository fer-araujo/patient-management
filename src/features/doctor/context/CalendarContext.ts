import { createContext } from "react";
import type { WeeklySchedule } from "../../../lib/services/settingsService";

export interface CalendarContextProps {
  baseDate: Date;
  setBaseDate: (date: Date) => void;
  calendarView: "day" | "week" | "month";
  setCalendarView: (view: "day" | "week" | "month") => void;
  workingSchedule: WeeklySchedule; // <-- CAMBIO AQUÍ
  setWorkingSchedule: (schedule: WeeklySchedule) => void; // <-- CAMBIO AQUÍ
}

export const CalendarContext = createContext<CalendarContextProps | undefined>(
  undefined,
);
