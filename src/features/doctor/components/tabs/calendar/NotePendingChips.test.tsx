import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { CalendarContext } from "../../../context/CalendarContext";
import { DEFAULT_SCHEDULE } from "../../../../../lib/services/settingsService";
import type { DashboardAppointment } from "../../../../../lib/services/clinicService";
import type { DashboardBlockedSlot } from "../../../../../lib/services/blockedSlotsService";
import { DailyView } from "./DailyView";
import { WeeklyView } from "./WeeklyView";
import { MonthlyView } from "./MonthlyView";

// Thursday 15 Oct 2026; the views match appointments by this label.
const BASE_DATE = new Date(2026, 9, 15, 7, 0);
const DATE_LABEL = BASE_DATE.toLocaleDateString("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
}).replace(/\./g, "");

const appt = (over: Partial<DashboardAppointment>): DashboardAppointment => ({
  id: "a-ana",
  patientId: "p-ana",
  patientName: "Ana Pérez",
  service: "Valoración",
  date: DATE_LABEL,
  isoDate: "2026-10-15",
  time: "10:00 AM",
  phone: "+528100000000",
  isNewPatient: false,
  status: "completed",
  durationMins: 60,
  reason: null,
  ...over,
});

interface ViewProps {
  appointments: DashboardAppointment[];
  blockedSlots: DashboardBlockedSlot[];
  onEmptySlotClick: (d: string, t: string) => void;
  onAppointmentClick: (a: DashboardAppointment) => void;
  onBlockClick: (b: DashboardBlockedSlot) => void;
}

const renderView = (View: ComponentType<ViewProps>, appointments: DashboardAppointment[]) =>
  render(
    <CalendarContext.Provider
      value={{
        baseDate: BASE_DATE,
        setBaseDate: vi.fn(),
        calendarView: "day",
        setCalendarView: vi.fn(),
        workingSchedule: DEFAULT_SCHEDULE,
        setWorkingSchedule: vi.fn(),
      }}
    >
      <View
        appointments={appointments}
        blockedSlots={[]}
        onEmptySlotClick={vi.fn()}
        onAppointmentClick={vi.fn()}
        onBlockClick={vi.fn()}
      />
    </CalendarContext.Provider>,
  );

describe.each([
  ["Día", DailyView],
  ["Semana", WeeklyView],
  ["Mes", MonthlyView],
] as const)("%s view: completed appointment with an open note", (_name, View) => {
  it('shows "Nota pendiente de cerrar" only on the appointment whose note is open', () => {
    renderView(View, [
      appt({ id: "a-open", patientName: "Ana Pérez", notePending: true }),
      appt({ id: "a-closed", patientName: "Luis Gómez", time: "12:00 PM", notePending: false }),
    ]);

    expect(screen.getAllByText("Nota pendiente de cerrar")).toHaveLength(1);
    expect(screen.getByText("Nota pendiente")).toBeInTheDocument();
  });
});
