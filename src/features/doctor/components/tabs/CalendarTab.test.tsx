import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { supabaseMock } from "../../../../test/supabaseMock";
import { CalendarProvider } from "../../context/CalendarProvider";
import type { DashboardAppointment } from "../../../../lib/services/clinicService";
import { CalendarTab } from "./CalendarTab";

// Default schedule: Mon-Fri 08:00 AM - 06:00 PM, Sat 09:00 AM - 02:00 PM,
// Sunday closed. October 2026: the 15th is a Thursday, the 18th a Sunday.
const appt = (over: Partial<DashboardAppointment>): DashboardAppointment => ({
  id: "a-ana",
  patientId: "p-ana",
  patientName: "Ana Pérez",
  service: "Valoración",
  date: "15 oct 2026",
  time: "10:00 AM",
  phone: "+528100000000",
  isNewPatient: false,
  status: "confirmed",
  durationMins: 30,
  reason: null,
  servicePrice: 500,
  ...over,
});

// Only there so "Marta López" and "Toxina" can be picked in the dropdowns.
const marta = appt({
  id: "a-marta",
  patientId: "p-marta",
  patientName: "Marta López",
  service: "Toxina",
  date: "20 oct 2026",
});

const renderTab = (appointments: DashboardAppointment[]) => {
  const onDataChange = vi.fn(async () => {});
  const ui = (list: DashboardAppointment[]) => (
    <CalendarProvider>
      <CalendarTab
        appointments={list}
        blockedSlots={[]}
        onStartConsultation={vi.fn()}
        onDataChange={onDataChange}
      />
    </CalendarProvider>
  );
  const view = render(ui(appointments));
  return {
    user: userEvent.setup(),
    onDataChange,
    rerenderWith: (list: DashboardAppointment[]) => view.rerender(ui(list)),
  };
};

/** A Dropdown trigger, found by the label it is associated with. */
const combobox = (label: string) => screen.getByRole("combobox", { name: label });

const setNow = (date: Date) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(date);
};

const openMonth = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Mes" }));
  // AnimatePresence mounts the month only after the week view has exited.
  await screen.findByText("Dom");
};

const openMonthDay = async (
  user: ReturnType<typeof userEvent.setup>,
  day: string,
) => {
  await openMonth(user);
  await user.click(screen.getByText(day));
};

/** The open Dropdown list (rendered in a portal) labelled by `label`. */
const listbox = (label: string) => screen.getByRole("listbox", { name: label });

const pickDropdownOption = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) => {
  await user.click(combobox(label));
  await user.click(within(listbox(label)).getByRole("option", { name: option }));
};

describe("CalendarTab pending appointments", () => {
  it("shows a rescheduled (pending) appointment in the week and month views", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([
      appt({}),
      appt({
        id: "a-luis",
        patientName: "Luis Pérez",
        time: "11:00 AM",
        durationMins: 60,
        status: "pending",
      }),
      appt({
        id: "a-rosa",
        patientName: "Rosa Pérez",
        time: "01:00 PM",
        status: "cancelled",
      }),
    ]);

    expect(screen.getByText("Luis Pérez")).toBeInTheDocument();
    expect(screen.getAllByText("Pendiente")).toHaveLength(1);
    expect(screen.queryByText("Rosa Pérez")).toBeNull();

    await openMonth(user);
    expect(screen.getByText("11:00 AM - Luis")).toBeInTheDocument();
    expect(screen.getAllByText("Pendiente")).toHaveLength(1);
    expect(screen.queryByText("01:00 PM - Rosa")).toBeNull();
  });
});

describe("CalendarTab scheduling", () => {
  it("asks for the time and never preselects an occupied opening slot", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([appt({ time: "08:00 AM" }), marta]);

    await openMonthDay(user, "15");

    expect(combobox("Hora")).toHaveTextContent("Seleccione una hora...");
    expect(screen.getByRole("button", { name: "Confirmar Cita" })).toBeDisabled();

    await user.click(combobox("Hora"));
    const times = listbox("Hora");
    expect(within(times).getByRole("option", { name: "08:30 AM" })).toBeInTheDocument();
    expect(within(times).queryByRole("option", { name: "08:00 AM" })).toBeNull();
  });

  it("books the chosen free time through the locked staff RPC", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    supabaseMock.onFrom("services", { data: { id: "srv-toxina" } });
    const { user, onDataChange } = renderTab([appt({}), marta]);

    await openMonthDay(user, "16");
    // The clicked (opening) time is free, so it is preselected.
    expect(combobox("Hora")).toHaveTextContent("08:00 AM");

    await pickDropdownOption(user, "Buscar Paciente", "Marta López");
    await pickDropdownOption(user, "Servicio a realizar", "Toxina");
    await user.click(screen.getByRole("button", { name: "Confirmar Cita" }));

    expect(supabaseMock.lastRpc("staff_create_appointment")?.args).toEqual({
      p_patient_id: "p-marta",
      p_service_id: "srv-toxina",
      // 08:00 AM in Monterrey (UTC-6).
      p_start_time: "2026-10-16T14:00:00.000Z",
    });
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(supabaseMock.queries("appointments")).toHaveLength(0);
  });

  it("never offers an archived patient in Buscar Paciente", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([
      appt({ patientStatus: "active" }),
      appt({
        id: "a-rosa",
        patientId: "p-rosa",
        patientName: "Rosa Archivada",
        date: "21 oct 2026",
        patientStatus: "archived",
      }),
      appt({
        id: "a-luis",
        patientId: "p-luis",
        patientName: "Luis Suspendido",
        date: "22 oct 2026",
        patientStatus: "blocked",
      }),
      marta,
    ]);

    await openMonthDay(user, "16");
    await user.click(combobox("Buscar Paciente"));
    const options = within(listbox("Buscar Paciente"));

    expect(options.queryByRole("option", { name: "Rosa Archivada" })).toBeNull();
    expect(options.getByRole("option", { name: "Ana Pérez" })).toBeInTheDocument();
    expect(options.getByRole("option", { name: "Marta López" })).toBeInTheDocument();
    // Suspended only blocks the public portal; the doctor can still book.
    expect(options.getByRole("option", { name: "Luis Suspendido" })).toBeInTheDocument();
  });

  it("starts the next booking empty instead of reusing the last patient and service", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    supabaseMock.onFrom("services", { data: { id: "srv-toxina" } });
    const { user, onDataChange } = renderTab([appt({}), marta]);

    await openMonthDay(user, "16");
    await pickDropdownOption(user, "Buscar Paciente", "Marta López");
    await pickDropdownOption(user, "Servicio a realizar", "Toxina");
    await user.click(screen.getByRole("button", { name: "Confirmar Cita" }));
    expect(onDataChange).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Confirmar Cita" })).toBeNull(),
    );

    // Another day: nothing from the previous booking is carried over.
    await user.click(screen.getByText("19"));
    expect(combobox("Buscar Paciente")).toHaveTextContent("Buscar por nombre...");
    expect(combobox("Servicio a realizar")).toHaveTextContent("Seleccione un servicio...");
    expect(screen.getByRole("button", { name: "Confirmar Cita" })).toBeDisabled();
  });

  it("refuses to book a time that became occupied after it was picked", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const toastError = vi.spyOn(toast, "error");
    const { user, rerenderWith } = renderTab([appt({}), marta]);

    await openMonthDay(user, "16");
    await pickDropdownOption(user, "Buscar Paciente", "Marta López");
    await pickDropdownOption(user, "Servicio a realizar", "Toxina");

    // A patient's request for the same time arrives before the doctor confirms.
    rerenderWith([
      appt({}),
      marta,
      appt({
        id: "a-nora",
        patientName: "Nora Ruiz",
        date: "16 oct 2026",
        time: "08:00 AM",
        status: "pending",
      }),
    ]);
    await user.click(screen.getByRole("button", { name: "Confirmar Cita" }));

    expect(toastError).toHaveBeenCalledWith("Ese horario ya está ocupado. Elija otra hora.");
    expect(supabaseMock.rpcCalls("staff_create_appointment")).toHaveLength(0);
  });

  it("shows the server's message when the slot was taken at the same moment", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const toastError = vi.spyOn(toast, "error");
    supabaseMock.onFrom("services", { data: { id: "srv-toxina" } });
    supabaseMock.onRpc("staff_create_appointment", {
      error: {
        code: "P0001",
        message: "El horario seleccionado acaba de ocuparse. Por favor elige otro.",
      },
    });
    const { user, onDataChange } = renderTab([appt({}), marta]);

    await openMonthDay(user, "16");
    await pickDropdownOption(user, "Buscar Paciente", "Marta López");
    await pickDropdownOption(user, "Servicio a realizar", "Toxina");
    await user.click(screen.getByRole("button", { name: "Confirmar Cita" }));

    expect(toastError).toHaveBeenCalledWith(
      "El horario seleccionado acaba de ocuparse. Por favor elige otro.",
    );
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe("CalendarTab rescheduling", () => {
  const openReschedule = async (user: ReturnType<typeof userEvent.setup>) => {
    await openMonth(user);
    await user.click(screen.getByText("10:00 AM - Ana"));
    await user.click(screen.getByRole("button", { name: "Reprogramar" }));
  };

  it("keeps the current time valid and does not offer closed days", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([appt({})]);

    await openReschedule(user);
    // The appointment's own slot does not collide with itself.
    expect(combobox("Nueva Hora")).toHaveTextContent("10:00 AM");
    expect(
      screen.getByRole("button", { name: "Confirmar Reprogramación" }),
    ).toBeEnabled();

    await user.click(screen.getByLabelText("Nueva Fecha"));
    expect(screen.getByRole("button", { name: "18" })).toBeDisabled(); // Sunday
    expect(screen.getByRole("button", { name: "16" })).toBeEnabled();
  });

  it("keeps confirm disabled when no future time is left that day", async () => {
    setNow(new Date(2026, 9, 15, 17, 30)); // 05:30 PM, closes at 06:00 PM
    const { user } = renderTab([appt({})]);

    await openReschedule(user);

    expect(combobox("Nueva Hora")).toHaveTextContent("Sin horarios");
    expect(
      screen.getByRole("button", { name: "Confirmar Reprogramación" }),
    ).toBeDisabled();
  });
});

describe("CalendarTab blocked slots", () => {
  it("rejects a block whose end time is before its start time", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const toastError = vi.spyOn(toast, "error");
    const { user } = renderTab([appt({})]);

    await openMonthDay(user, "16");
    await user.click(screen.getByRole("button", { name: "Bloquear Horario" }));
    expect(combobox("Hora Fin")).toHaveTextContent("09:00 AM");
    await pickDropdownOption(user, "Hora Fin", "07:00 AM");
    await user.click(screen.getByRole("button", { name: "Bloquear Fechas" }));

    expect(toastError).toHaveBeenCalledWith(
      "La hora de fin debe ser después de la hora de inicio.",
    );
    expect(supabaseMock.queries("blocked_slots")).toHaveLength(0);
  });

  it("does not let the start date go past the end date", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([appt({})]);

    await openMonthDay(user, "16");
    await user.click(screen.getByRole("button", { name: "Bloquear Horario" }));
    await user.click(screen.getByLabelText("Desde (Fecha)"));

    expect(screen.getByRole("button", { name: "16" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "17" })).toBeDisabled();
  });
});
