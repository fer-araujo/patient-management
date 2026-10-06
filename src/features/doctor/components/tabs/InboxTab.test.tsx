import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import {
  ClinicModeContext,
  DEFAULT_CLINIC_MODE,
} from "../../../clinicMode/clinicModeContext";
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

describe("InboxTab in doctor-only mode", () => {
  const renderInMode = (doctorOnlyMode: boolean) =>
    render(
      <ClinicModeContext.Provider value={{ ...DEFAULT_CLINIC_MODE, doctorOnlyMode }}>
        <CalendarProvider>
          <InboxTab
            appointments={APPOINTMENTS}
            blockedSlots={[]}
            onDataChange={vi.fn(async () => {})}
          />
        </CalendarProvider>
      </ClinicModeContext.Provider>,
    );

  const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

  it("offers Aprobar, Sugerir horario and Rechazar for an online request when the mode is off", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    renderInMode(false);

    const row = rowOf("Ana Futura");
    expect(within(row).getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Sugerir horario" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Rechazar Solicitud" })).toBeInTheDocument();
    expect(statValue("Por Revisar")).toBe("1");
  });

  it("hides the online-request actions and handles a leftover request like any appointment", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    supabaseMock.onFrom("appointments", { data: null });
    renderInMode(true);
    const user = userEvent.setup();

    const row = rowOf("Ana Futura");
    expect(within(row).queryByRole("button", { name: "Aprobar" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Sugerir horario" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Rechazar Solicitud" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Cancelar Cita" })).toBeInTheDocument();

    // No "to review" wording: nothing arrives online any more.
    expect(screen.queryByText("Por Revisar")).toBeNull();
    expect(statValue("Sin confirmar")).toBe("1");

    // Moving it is a plain reschedule, not a suggestion to the patient.
    await user.click(within(row).getByRole("button", { name: "Reprogramar" }));
    expect(screen.getByText("Reprogramar Cita")).toBeInTheDocument();
    expect(screen.queryByText("Sugerir Horario")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    // A visible "Confirmar" (no hover-only icon) confirms it.
    const confirm = within(row).getByRole("button", { name: /Confirmar/ });
    expect(confirm).toHaveAttribute("type", "button");
    await user.click(confirm);
    await waitFor(() =>
      expect(
        supabaseMock.queries("appointments").find((q) => q.has("update"))?.args("update"),
      ).toEqual([{ status: "confirmed" }]),
    );
  });
});


describe("InboxTab overdue pending appointments", () => {
  const renderInMode = (doctorOnlyMode: boolean) =>
    render(
      <ClinicModeContext.Provider
        value={{ ...DEFAULT_CLINIC_MODE, doctorOnlyMode }}
      >
        <CalendarProvider>
          <InboxTab
            appointments={APPOINTMENTS}
            blockedSlots={[]}
            onDataChange={vi.fn(async () => {})}
          />
        </CalendarProvider>
      </ClinicModeContext.Provider>,
    );

  const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

  /** Accessible names of every action button in a row. */
  const actionsOf = (name: string) =>
    within(rowOf(name))
      .getAllByRole("button")
      .map(
        (button) =>
          button.getAttribute("aria-label") ?? button.textContent?.trim(),
      );

  it.each([
    {
      mode: "off",
      doctorOnlyMode: false,
      upcomingActions: ["Aprobar", "Sugerir horario", "Rechazar Solicitud"],
    },
    {
      mode: "on",
      doctorOnlyMode: true,
      upcomingActions: ["Confirmar", "Reprogramar", "Cancelar Cita"],
    },
  ])(
    "shows a past pending appointment as Vencida with only Reprogramar and Cancelar (doctor-only mode $mode)",
    ({ doctorOnlyMode, upcomingActions }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      renderInMode(doctorOnlyMode);

      // Beto's pending visit (10 oct) already passed.
      expect(
        within(rowOf("Beto Pasado")).getByText("Vencida"),
      ).toBeInTheDocument();
      expect(within(rowOf("Beto Pasado")).queryByText("Pendiente")).toBeNull();
      expect(actionsOf("Beto Pasado")).toEqual([
        "Reprogramar",
        "Cancelar Cita",
      ]);

      // Ana's pending visit (16 oct) is still ahead: unchanged.
      expect(
        within(rowOf("Ana Futura")).getByText("Pendiente"),
      ).toBeInTheDocument();
      expect(actionsOf("Ana Futura")).toEqual(upcomingActions);

      // Overdue requests are not counted as waiting for review.
      expect(statValue(doctorOnlyMode ? "Sin confirmar" : "Por Revisar")).toBe(
        "1",
      );
    },
  );

  it("keeps overdue appointments under the Pendientes filter", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    renderInMode(false);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Filtros Avanzados/ }));
    await user.click(screen.getByRole("button", { name: "Pendientes" }));
    await user.click(screen.getByRole("button", { name: "Aplicar Filtros" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("Ana Futura")).toBeInTheDocument();
    expect(within(table).getByText("Beto Pasado")).toBeInTheDocument();
    expect(within(table).queryByText("Carla Futura")).toBeNull();
  });

  it("titles the move of an overdue request Reprogramar Cita, not Sugerir Horario", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    renderInMode(false);
    const user = userEvent.setup();

    await user.click(
      within(rowOf("Beto Pasado")).getByRole("button", { name: "Reprogramar" }),
    );
    expect(screen.getByText("Reprogramar Cita")).toBeInTheDocument();
    expect(screen.queryByText("Sugerir Horario")).toBeNull();
  });
});

describe("InboxTab rescheduling an overdue appointment", () => {
  const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

  it("starts on the clinic's today and never offers a slot that already started", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW); // Thursday 2026-10-15, 12:00 PM
    renderInbox(APPOINTMENTS);
    const user = userEvent.setup();

    // Beto's pending visit was on 10 oct at 10:00 AM.
    await user.click(
      within(rowOf("Beto Pasado")).getByRole("button", { name: "Reprogramar" }),
    );

    // Pre-filled with today, not the past day.
    expect(screen.getByText("2026-10-15")).toBeInTheDocument();
    // First slot strictly after now (12:00 PM is "now", so not bookable).
    const combobox = within(screen.getByText("Nueva Hora").parentElement!).getByRole("combobox");
    expect(combobox).toHaveTextContent("12:15 PM");

    await user.click(combobox);
    const options = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).not.toContain("10:00 AM");
    expect(options).not.toContain("12:00 PM");
    expect(options).toContain("12:15 PM");
    expect(
      screen.getByRole("button", { name: "Confirmar y Avisar" }),
    ).toBeEnabled();
  });

  it("keeps the confirm button disabled when no future slot is left today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 5:50 PM: the last 30-minute slot (5:30 PM) already started.
    vi.setSystemTime(new Date(2026, 9, 15, 17, 50));
    renderInbox(APPOINTMENTS);
    const user = userEvent.setup();

    await user.click(
      within(rowOf("Beto Pasado")).getByRole("button", { name: "Reprogramar" }),
    );

    expect(within(screen.getByText("Nueva Hora").parentElement!).getByRole("combobox")).toHaveTextContent("Sin horarios");
    expect(
      screen.getByRole("button", { name: "Confirmar y Avisar" }),
    ).toBeDisabled();
  });
});

describe("InboxTab shared clock", () => {
  it("moves a pending row to Vencida and drops it from the card once its start passes", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    // One minute before Ana's pending visit (16 oct, 10:00 AM).
    vi.setSystemTime(new Date(2026, 9, 16, 9, 59));
    const { unmount } = renderInbox(APPOINTMENTS);

    const anaRow = () => screen.getByText("Ana Futura").closest("tr")!;
    expect(within(anaRow()).getByText("Pendiente")).toBeInTheDocument();
    expect(statValue("Por Revisar")).toBe("1");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // Cards and rows read the same clock: both flip together.
    expect(within(anaRow()).getByText("Vencida")).toBeInTheDocument();
    expect(statValue("Por Revisar")).toBe("0");

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
