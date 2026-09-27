import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CalendarProvider } from "../../context/CalendarProvider";
import type { DashboardAppointment } from "../../../../lib/services/clinicService";
import { InboxTab } from "./InboxTab";

// "Now" is Thursday 2026-10-15 at 12:00 PM (Monterrey). The inbox window
// starts 30 days earlier, on 2026-09-15 at midnight.
const NOW = new Date(2026, 9, 15, 12, 0);

const appt = (over: Partial<DashboardAppointment>): DashboardAppointment => ({
  id: "a",
  patientId: "p",
  patientName: "Paciente",
  service: "Valoración",
  date: "16 oct 2026",
  time: "10:00 AM",
  phone: "+528100000000",
  isNewPatient: false,
  status: "confirmed",
  durationMins: 30,
  reason: null,
  servicePrice: 500,
  ...over,
});

const APPOINTMENTS: DashboardAppointment[] = [
  // Upcoming pending request: counted in "Por Revisar".
  appt({ id: "1", patientName: "Ana Futura", status: "pending", isNewPatient: true }),
  // Pending, in the window but already past: shown, not counted as to review.
  appt({ id: "2", patientName: "Beto Pasado", status: "pending", date: "10 oct 2026" }),
  // Upcoming confirmed visit: counted in "Confirmadas".
  appt({ id: "3", patientName: "Carla Futura", date: "20 oct 2026", isNewPatient: true }),
  // Confirmed earlier today: shown, not counted as confirmed.
  appt({ id: "4", patientName: "Diego Hoy", date: "15 oct 2026", time: "09:00 AM" }),
  // Completed inside the window.
  appt({
    id: "5",
    patientName: "Elena Completa",
    status: "completed",
    date: "01 oct 2026",
    isNewPatient: true,
  }),
  // Older than 30 days: outside every window-based number and the table.
  appt({
    id: "6",
    patientName: "Fer Antigua",
    status: "cancelled",
    date: "01 ago 2026",
    isNewPatient: true,
  }),
];

const renderInbox = (appointments: DashboardAppointment[]) =>
  render(
    <CalendarProvider>
      <InboxTab
        appointments={appointments}
        blockedSlots={[]}
        onDataChange={vi.fn(async () => {})}
      />
    </CalendarProvider>,
  );

/** The number shown on the stat card with this title. */
const statValue = (title: string) =>
  within(screen.getByText(title, { selector: "p" }).parentElement!).getByRole("heading")
    .textContent;

describe("InboxTab stats", () => {
  it("counts only upcoming appointments to review/confirmed, and the 30-day window for the rest", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    renderInbox(APPOINTMENTS);

    // Current data: what still needs attention or is still ahead.
    expect(statValue("Por Revisar")).toBe("1");
    expect(statValue("Confirmadas")).toBe("1");
    // 30-day window: everything from 2026-09-15 onward, past or future.
    expect(statValue("Nuevos Pac.")).toBe("3");
    expect(statValue("Total Agenda")).toBe("5");
  });

  it("lists the same 30-day window in the table", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    renderInbox(APPOINTMENTS);

    const table = screen.getByRole("table");
    for (const name of ["Ana Futura", "Beto Pasado", "Carla Futura", "Diego Hoy", "Elena Completa"]) {
      expect(within(table).getByText(name)).toBeInTheDocument();
    }
    expect(within(table).queryByText("Fer Antigua")).toBeNull();
    // Header row + the five appointments in the window.
    expect(within(table).getAllByRole("row")).toHaveLength(6);
  });
});
