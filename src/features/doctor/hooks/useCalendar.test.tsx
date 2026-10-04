import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { supabaseMock } from "../../../test/supabaseMock";
import { DEFAULT_SCHEDULE, type WeeklySchedule } from "../../../lib/services/settingsService";
import { CalendarProvider } from "../context/CalendarProvider";
import { useCalendar } from "./useCalendar";

const wrapper = ({ children }: { children: ReactNode }) => (
  <CalendarProvider>{children}</CalendarProvider>
);

const savedSchedule: WeeklySchedule = {
  ...DEFAULT_SCHEDULE,
  6: { isOpen: false, start: "09:00 AM", end: "02:00 PM" },
};

describe("useCalendar", () => {
  it("throws a clear error outside a CalendarProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCalendar())).toThrow(
      "useCalendar debe usarse dentro de un CalendarProvider",
    );
  });

  it("starts in the week view on today's date with the default schedule", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15, 9, 0));

    const { result } = renderHook(() => useCalendar(), { wrapper });

    expect(result.current.calendarView).toBe("week");
    expect(result.current.baseDate).toEqual(new Date(2026, 9, 15, 9, 0));
    expect(result.current.workingSchedule).toEqual(DEFAULT_SCHEDULE);
  });

  it("loads the saved clinic schedule", async () => {
    supabaseMock.onFrom("clinic_settings", { data: { schedule: savedSchedule } });

    const { result } = renderHook(() => useCalendar(), { wrapper });

    await waitFor(() => expect(result.current.workingSchedule).toEqual(savedSchedule));
    const query = supabaseMock.queries("clinic_settings")[0];
    expect(query.args("select")).toEqual(["schedule"]);
  });

  it("keeps the default schedule when settings cannot be loaded", async () => {
    supabaseMock.onFrom("clinic_settings", { error: { message: "denied" } });

    const { result } = renderHook(() => useCalendar(), { wrapper });

    await waitFor(() => expect(supabaseMock.queries("clinic_settings")).toHaveLength(1));
    expect(result.current.workingSchedule).toEqual(DEFAULT_SCHEDULE);
  });

  it("exposes setters for the view, date and schedule", async () => {
    const { result } = renderHook(() => useCalendar(), { wrapper });
    await waitFor(() => expect(supabaseMock.queries("clinic_settings")).toHaveLength(1));

    const target = new Date(2026, 11, 1);
    act(() => {
      result.current.setCalendarView("month");
      result.current.setBaseDate(target);
      result.current.setWorkingSchedule(savedSchedule);
    });

    expect(result.current.calendarView).toBe("month");
    expect(result.current.baseDate).toBe(target);
    expect(result.current.workingSchedule).toEqual(savedSchedule);
  });
});
