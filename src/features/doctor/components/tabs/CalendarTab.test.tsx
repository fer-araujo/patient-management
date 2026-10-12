import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { supabaseMock } from "../../../../test/supabaseMock";
import { CalendarProvider } from "../../context/CalendarProvider";
import type { DashboardAppointment } from "../../../../lib/services/clinicService";
import { CalendarTab } from "./CalendarTab";
import { mockPhoneViewport } from "../../../../test/viewport";

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

// An existing booking of Marta's on another day: it is NOT what makes her
// (or Toxina) pickable; the dropdowns come from the patients and services tables.
const marta = appt({
  id: "a-marta",
  patientId: "p-marta",
  patientName: "Marta López",
  service: "Toxina",
  date: "20 oct 2026",
});

/** A row of public.patients as fetchPatients reads it. */
const patientRow = (
  id: string,
  firstName: string,
  lastName: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  first_name: firstName,
  last_name: lastName,
  phone: "+528100000000",
  email: null,
  dob: null,
  gender: null,
  blood_type: null,
  allergies: null,
  chronic_conditions: null,
  notes: null,
  status: "active",
  anonymized_at: null,
  weight_tracking: false,
  appointments: [],
  consents: [],
  ...over,
});

/** A row of public.services as fetchActiveServices reads it. */
const serviceRow = (
  id: string,
  name: string,
  durationMins: number,
  over: Record<string, unknown> = {},
) => ({
  id,
  name,
  category: "Tratamiento",
  description: "",
  duration_mins: durationMins,
  price: 1000,
  care_guide: "",
  is_active: true,
  ...over,
});

const defaultPatients = [
  patientRow("p-ana", "Ana", "Pérez"),
  patientRow("p-marta", "Marta", "López"),
];
const defaultServices = [
  serviceRow("srv-valoracion", "Valoración", 30),
  serviceRow("srv-toxina", "Toxina", 30),
];

/** What "Agendar Cita" reads when it opens: the directory and the active catalog. */
const stubBookingCatalog = (
  patients: unknown[] = defaultPatients,
  services: unknown[] = defaultServices,
) => {
  supabaseMock.onFrom("patients", { data: patients });
  supabaseMock.onFrom("services", { data: services });
};

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

/** "Agendar Cita" shows its patient and service lists once both are loaded. */
const waitForBookingLists = () =>
  screen.findByRole("combobox", { name: "Buscar Paciente" });

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

  it("labels a pending appointment whose start already passed as Vencida", async () => {
    // 12:00 PM: Luis (11:00 AM) already started, Sofía (03:00 PM) is ahead.
    setNow(new Date(2026, 9, 15, 12, 0));
    const { user } = renderTab([
      appt({
        id: "a-luis",
        patientName: "Luis Pérez",
        time: "11:00 AM",
        status: "pending",
      }),
      appt({
        id: "a-sofia",
        patientName: "Sofía Ruiz",
        time: "03:00 PM",
        status: "pending",
      }),
    ]);

    expect(screen.getAllByText("Vencida")).toHaveLength(1);
    expect(screen.getAllByText("Pendiente")).toHaveLength(1);

    await openMonth(user);
    expect(screen.getAllByText("Vencida")).toHaveLength(1);
    expect(screen.getAllByText("Pendiente")).toHaveLength(1);
  });
});

describe("CalendarTab scheduling", () => {
  beforeEach(() => stubBookingCatalog());

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
    const { user, onDataChange } = renderTab([appt({}), marta]);

    await openMonthDay(user, "16");
    // The clicked (opening) time is free, so it is preselected.
    expect(combobox("Hora")).toHaveTextContent("08:00 AM");

    await waitForBookingLists();
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

  it("books a brand-new patient and a never-booked service with an empty calendar", async () => {
    // Right after the pre-production reset: no appointment at all.
    setNow(new Date(2026, 9, 14, 7, 0));
    supabaseMock.reset();
    stubBookingCatalog(
      [patientRow("p-nueva", "Nadia", "Nueva")],
      [serviceRow("srv-relleno", "Relleno", 60)],
    );
    const { user, onDataChange } = renderTab([]);

    await openMonthDay(user, "16");
    await waitForBookingLists();
    await pickDropdownOption(user, "Buscar Paciente", "Nadia Nueva");
    await pickDropdownOption(user, "Servicio a realizar", "Relleno");
    await user.click(screen.getByRole("button", { name: "Confirmar Cita" }));

    expect(supabaseMock.lastRpc("staff_create_appointment")?.args).toEqual({
      p_patient_id: "p-nueva",
      p_service_id: "srv-relleno",
      p_start_time: "2026-10-16T14:00:00.000Z",
    });
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it("sizes the free times with the catalog duration of a never-booked service", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    supabaseMock.reset();
    stubBookingCatalog(defaultPatients, [
      serviceRow("srv-valoracion", "Valoración", 30),
      serviceRow("srv-relleno", "Relleno", 120),
    ]);
    // Friday 16: one 30-minute booking at 10:00 AM; the clinic closes at 06:00 PM.
    const { user } = renderTab([appt({ date: "16 oct 2026", time: "10:00 AM" })]);

    await openMonthDay(user, "16");
    await waitForBookingLists();

    await pickDropdownOption(user, "Servicio a realizar", "Valoración");
    await user.click(combobox("Hora"));
    expect(within(listbox("Hora")).getByRole("option", { name: "09:30 AM" })).toBeInTheDocument();
    expect(within(listbox("Hora")).getByRole("option", { name: "05:30 PM" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // Relleno (120 min) was never booked: its length comes from the catalog.
    await pickDropdownOption(user, "Servicio a realizar", "Relleno");
    await user.click(combobox("Hora"));
    const times = within(listbox("Hora"));
    expect(times.getByRole("option", { name: "08:00 AM" })).toBeInTheDocument();
    expect(times.queryByRole("option", { name: "09:00 AM" })).toBeNull();
    expect(times.queryByRole("option", { name: "09:30 AM" })).toBeNull();
    expect(times.getByRole("option", { name: "04:00 PM" })).toBeInTheDocument();
    expect(times.queryByRole("option", { name: "04:30 PM" })).toBeNull();
  });

  it("offers active, non-archived patients by name and only active services", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    supabaseMock.reset();
    stubBookingCatalog(
      [
        patientRow("p-rosa", "Rosa", "Archivada", { status: "archived" }),
        patientRow("p-luis", "Luis", "Suspendido", { status: "blocked" }),
        patientRow("p-anon", "Anónimo", "ARCO", { anonymized_at: "2026-09-01T00:00:00Z" }),
        patientRow("p-marta", "Marta", "López"),
        patientRow("p-ana-1", "Ana", "Pérez", { phone: "+528111111234" }),
        patientRow("p-ana-2", "Ana", "Pérez", { phone: "+528122225678" }),
      ],
      [
        serviceRow("srv-toxina", "Toxina", 30),
        serviceRow("srv-viejo", "Peeling retirado", 45, { is_active: false }),
      ],
    );
    // No appointment at all: nothing is derived from the agenda.
    const { user } = renderTab([]);

    await openMonthDay(user, "16");
    await waitForBookingLists();

    await user.click(combobox("Buscar Paciente"));
    const patients = within(listbox("Buscar Paciente"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(patients).toEqual([
      // Same name: the last 4 digits of the phone tell them apart.
      "Ana Pérez · tel. 1234",
      "Ana Pérez · tel. 5678",
      // Suspended only blocks the public portal; the doctor can still book.
      "Luis Suspendido",
      "Marta López",
      "+ Crear nuevo paciente",
    ]);
    await user.keyboard("{Escape}");

    await user.click(combobox("Servicio a realizar"));
    const services = within(listbox("Servicio a realizar"));
    expect(services.getByRole("option", { name: "Toxina" })).toBeInTheDocument();
    expect(services.queryByRole("option", { name: "Peeling retirado" })).toBeNull();
    // The server is asked for active services only, too.
    expect(supabaseMock.queries("services")[0].args("eq")).toEqual(["is_active", true]);
  });

  it("shows a clear error with Reintentar when the lists cannot be loaded", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.reset();
    // The first read fails; the retry answers.
    supabaseMock.onFrom(
      "patients",
      { error: { message: "network down" } },
      { data: defaultPatients },
    );
    supabaseMock.onFrom("services", { data: defaultServices });
    const { user } = renderTab([]);

    await openMonthDay(user, "16");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo cargar la lista de pacientes y servicios.");
    expect(screen.queryByRole("combobox", { name: "Buscar Paciente" })).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar Cita" })).toBeDisabled();

    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));

    await waitForBookingLists();
    expect(screen.queryByRole("alert")).toBeNull();
    await pickDropdownOption(user, "Buscar Paciente", "Marta López");
    expect(combobox("Buscar Paciente")).toHaveTextContent("Marta López");
  });

  it("re-reads the lists each time Agendar Cita opens, so a patient created meanwhile appears", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    supabaseMock.reset();
    supabaseMock.onFrom("services", { data: defaultServices });
    // Each read answers with the directory of that moment.
    let directory = [patientRow("p-ana", "Ana", "Pérez")];
    supabaseMock.onFrom("patients", () => ({ data: directory }));
    const { user } = renderTab([]);

    await openMonthDay(user, "16");
    await waitForBookingLists();
    await user.click(screen.getByRole("button", { name: "Cerrar ventana" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Confirmar Cita" })).toBeNull(),
    );

    directory = [...directory, patientRow("p-nadia", "Nadia", "Nueva")];
    await user.click(screen.getByText("19"));
    await waitForBookingLists();
    await user.click(combobox("Buscar Paciente"));
    expect(
      within(listbox("Buscar Paciente")).getByRole("option", { name: "Nadia Nueva" }),
    ).toBeInTheDocument();
  });

  it("starts the next booking empty instead of reusing the last patient and service", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user, onDataChange } = renderTab([appt({}), marta]);

    await openMonthDay(user, "16");
    await waitForBookingLists();
    await pickDropdownOption(user, "Buscar Paciente", "Marta López");
    await pickDropdownOption(user, "Servicio a realizar", "Toxina");
    await user.click(screen.getByRole("button", { name: "Confirmar Cita" }));
    expect(onDataChange).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Confirmar Cita" })).toBeNull(),
    );

    // Another day: nothing from the previous booking is carried over.
    await user.click(screen.getByText("19"));
    await waitForBookingLists();
    expect(combobox("Buscar Paciente")).toHaveTextContent("Buscar por nombre...");
    expect(combobox("Servicio a realizar")).toHaveTextContent("Seleccione un servicio...");
    expect(screen.getByRole("button", { name: "Confirmar Cita" })).toBeDisabled();
  });

  it("refuses to book a time that became occupied after it was picked", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const toastError = vi.spyOn(toast, "error");
    const { user, rerenderWith } = renderTab([appt({}), marta]);

    await openMonthDay(user, "16");
    await waitForBookingLists();
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
    supabaseMock.onRpc("staff_create_appointment", {
      error: {
        code: "P0001",
        message: "El horario seleccionado acaba de ocuparse. Por favor elige otro.",
      },
    });
    const { user, onDataChange } = renderTab([appt({}), marta]);

    await openMonthDay(user, "16");
    await waitForBookingLists();
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

describe("CalendarTab consultations without recorded supplies", () => {
  // Thursday 15 Oct 2026 has passed: both consultations were finalized.
  const pending = appt({
    status: "completed",
    serviceId: "svc-relleno",
    service: "Relleno",
    suppliesPending: true,
  });
  const recorded = appt({
    id: "a-luis",
    patientId: "p-luis",
    patientName: "Luis Gómez",
    time: "12:00 PM",
    status: "completed",
    suppliesPending: false,
  });

  const stubSupplies = () => {
    supabaseMock.onFrom("inventory", {
      data: [
        {
          id: "item-s", name: "Sculptra", category: "Medicamentos", stock_quantity: 3,
          min_alert_level: 1, unit_measure: "viales", last_restock_date: "2026-09-01", is_active: true,
        },
        {
          id: "item-g", name: "Gasas", category: "Insumos", stock_quantity: 50,
          min_alert_level: 1, unit_measure: "paquetes", last_restock_date: "2026-09-01", is_active: true,
        },
      ],
    });
    supabaseMock.onFrom("service_supplies", {
      data: [{ item_id: "item-s", quantity: 1, inventory: { name: "Sculptra", unit_measure: "viales" } }],
    });
  };

  const cardOf = (name: string) => screen.getByText(name).closest("div.cursor-pointer")!;

  it("shows finalized consultations, in faded red only when their supplies are missing", async () => {
    setNow(new Date(2026, 9, 16, 12, 0));
    const { user } = renderTab([pending, recorded]);

    // Completed consultations are visible again, with their usual style...
    expect(cardOf("Luis Gómez")).not.toHaveClass("bg-rose-50");
    expect(cardOf("Luis Gómez")).toHaveClass("opacity-60");
    // ...and the one without supplies in the rose warning palette.
    expect(cardOf("Ana Pérez")).toHaveClass("bg-rose-50", "border-rose-200", "text-rose-600", "opacity-60");
    expect(within(cardOf("Ana Pérez") as HTMLElement).getByText("Sin insumos")).toBeInTheDocument();
    expect(screen.getAllByText("Sin insumos")).toHaveLength(1);
    expect(screen.getByText("En rojo: consultas sin insumos registrados.")).toBeInTheDocument();

    await openMonth(user);
    expect(screen.getByText(/10:00 AM - Ana/).className).toContain("bg-rose-50");
    expect(screen.getByText(/12:00 PM - Luis/).className).not.toContain("bg-rose-50");
  });

  it("a recorded consultation offers no \"Registrar insumos\" and can no longer be cancelled or started", async () => {
    setNow(new Date(2026, 9, 16, 12, 0));
    const { user } = renderTab([pending, recorded]);

    await user.click(screen.getByText("Luis Gómez"));
    await screen.findByText("Detalles de la Cita");

    expect(screen.queryByRole("button", { name: "Registrar insumos" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar Cita" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar" })).toBeNull();
  });

  it('"Registrar insumos" opens the supplies list pre-filled from the service and records it', async () => {
    setNow(new Date(2026, 9, 16, 12, 0));
    stubSupplies();
    const { user, onDataChange } = renderTab([pending, recorded]);

    await user.click(screen.getByText("Ana Pérez"));
    expect(await screen.findByText("Sin insumos registrados")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registrar insumos" }));

    expect(await screen.findByLabelText("Cantidad de Sculptra")).toHaveValue(1);
    expect(screen.getByText("En inventario: 3")).toBeInTheDocument();
    expect(supabaseMock.queries("service_supplies")[0].args("eq")).toEqual(["service_id", "svc-relleno"]);

    // The same stock check as at checkout.
    await user.clear(screen.getByLabelText("Cantidad de Sculptra"));
    await user.type(screen.getByLabelText("Cantidad de Sculptra"), "4");
    expect(screen.getByText("Solo hay 3 en inventario")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar insumos/ })).toBeDisabled();
    await user.clear(screen.getByLabelText("Cantidad de Sculptra"));
    await user.type(screen.getByLabelText("Cantidad de Sculptra"), "2");

    // Picking an item adds it right away with 1; a listed one jumps to its row.
    await user.click(screen.getByRole("combobox", { name: "Insumos usados" }));
    await user.click(screen.getByRole("option", { name: "Sculptra (ya en la lista)" }));
    expect(screen.getAllByLabelText("Cantidad de Sculptra")).toHaveLength(1);
    expect(screen.getByLabelText("Cantidad de Sculptra")).toHaveFocus();
    await user.click(screen.getByRole("combobox", { name: "Insumos usados" }));
    await user.click(screen.getByRole("option", { name: "Gasas" }));
    expect(screen.getByLabelText("Cantidad de Gasas")).toHaveValue(1);
    expect(screen.getByLabelText("Cantidad de Sculptra")).toHaveValue(2);

    await user.click(screen.getByRole("button", { name: /Guardar insumos/ }));

    await waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    expect(supabaseMock.rpcCalls("record_consultation_supplies")).toEqual([
      {
        name: "record_consultation_supplies",
        args: {
          p_appointment_id: "a-ana",
          p_supplies: [
            { item_id: "item-s", quantity: 2 },
            { item_id: "item-g", quantity: 1 },
          ],
        },
      },
    ]);
    await waitFor(() => expect(screen.queryByLabelText("Cantidad de Sculptra")).toBeNull());
  });

  it("shows the refusal when the supplies were already recorded, and stays open", async () => {
    setNow(new Date(2026, 9, 16, 12, 0));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    stubSupplies();
    supabaseMock.onRpc("record_consultation_supplies", {
      error: { code: "P0001", message: "Los insumos de esta consulta ya estaban registrados." },
    });
    const { user, onDataChange } = renderTab([pending]);

    await user.click(screen.getByText("Ana Pérez"));
    await user.click(await screen.findByRole("button", { name: "Registrar insumos" }));
    await screen.findByLabelText("Cantidad de Sculptra");
    await user.click(screen.getByRole("button", { name: /Guardar insumos/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Los insumos de esta consulta ya estaban registrados."),
    );
    expect(onDataChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Cantidad de Sculptra")).toBeInTheDocument();
  });
});

describe("CalendarTab prescription of a finalized consultation", () => {
  const done = appt({ id: "a-luis", patientId: "p-luis", patientName: "Luis Gómez", status: "completed" });

  const stubPrescription = () => {
    supabaseMock.onFrom("prescriptions", {
      data: {
        id: "rx-luis",
        appointment_id: "a-luis",
        patient_id: "p-luis",
        medications: [{ nombre: "Ibuprofeno", dosis: "400 mg", via: "Oral", frecuencia: "Cada 8 h", indicaciones: "" }],
        created_at: "2026-10-15T16:00:00Z",
        finalized_at: "2026-10-15T17:00:00Z",
      },
    });
    supabaseMock.onFrom("patients", {
      data: {
        id: "p-luis", first_name: "Luis", last_name: "Gómez", phone: "+528100000001", email: null,
        gender: "Masculino", dob: "1980-02-01", blood_type: null, allergies: null, chronic_conditions: null,
        address: null, family_history: null, personal_pathological_history: null,
        non_pathological_history: null, current_illness: null, anonymized_at: null,
      },
    });
  };

  it("offers Enviar por WhatsApp / Ver for its finalized prescription", async () => {
    setNow(new Date(2026, 9, 16, 12, 0));
    stubPrescription();
    const { user } = renderTab([done]);

    await user.click(screen.getByText("Luis Gómez"));
    await screen.findByText("Detalles de la Cita");

    expect(
      await screen.findByRole("button", { name: /^Enviar por WhatsApp la receta/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Ver o imprimir la receta/ })).toBeInTheDocument();
    expect(screen.getByText("Receta")).toBeInTheDocument();
    const query = supabaseMock.queries("prescriptions")[0];
    expect(query.args("eq")).toEqual(["appointment_id", "a-luis"]);
    expect(query.args("not")).toEqual(["finalized_at", "is", null]);
  });

  it("shows no prescription actions when the consultation has none", async () => {
    setNow(new Date(2026, 9, 16, 12, 0));
    const { user } = renderTab([done]);

    await user.click(screen.getByText("Luis Gómez"));
    await screen.findByText("Detalles de la Cita");

    await waitFor(() => expect(supabaseMock.queries("prescriptions")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /^Enviar por WhatsApp la receta/ })).toBeNull();
    expect(supabaseMock.queries("patients")).toHaveLength(0);
  });

  it("never looks for a prescription of an appointment that is not finalized", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([appt({})]);

    await user.click(screen.getByText("Ana Pérez"));
    await screen.findByText("Detalles de la Cita");

    expect(screen.getByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    expect(supabaseMock.queries("prescriptions")).toHaveLength(0);
  });
});

describe("CalendarTab on a touch screen", () => {
  it("tapping an appointment in the month view opens it, not the day's booking flow", async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([appt({})]);

    await openMonth(user);
    await user.click(screen.getByText("10:00 AM - Ana"));

    expect(await screen.findByText("Detalles de la Cita")).toBeInTheDocument();
    expect(screen.queryByText("Gestión de Agenda")).toBeNull();
    expect(screen.queryByRole("button", { name: "Agendar Cita" })).toBeNull();
  });

  it('"Ir a hoy" is a button that brings the calendar back to the current month', async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([]);

    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: "Siguiente" }));
    }
    expect(screen.getByRole("heading", { name: /noviembre 2026/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ir a hoy" }));
    expect(screen.getByRole("heading", { name: /octubre 2026/i })).toBeInTheDocument();
  });

  it('"Horarios de Clínica" is reachable below desktop widths and opens the weekly schedule', async () => {
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([]);

    const settings = screen.getByRole("button", { name: "Horarios de Clínica" });
    expect(settings).not.toHaveClass("hidden");

    await user.click(settings);
    expect(await screen.findByText("Configuración Semanal")).toBeInTheDocument();
  });
});

describe("CalendarTab on a phone (440 px)", () => {
  it("opens on Día, offers no Semana, and a month day opens that day", async () => {
    mockPhoneViewport();
    setNow(new Date(2026, 9, 14, 7, 0));
    const { user } = renderTab([
      appt({}),
      appt({ id: "a-luis", patientName: "Luis Pérez", time: "11:00 AM" }),
    ]);

    expect(screen.getByRole("button", { name: "Día" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Semana" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Mes" }));
    // Compact cells: a count per day instead of appointment chips.
    const thursday = await screen.findByRole("button", {
      name: "jueves, 15 de octubre: 2 citas",
    });
    expect(screen.queryByText("10:00 AM - Ana")).toBeNull();
    expect(within(thursday).getByText("2")).toBeInTheDocument();

    await user.click(thursday);
    expect(screen.getByRole("button", { name: "Día" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Luis Pérez")).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
  });

  it("a Semana chosen in landscape shows as Día in portrait and comes back after rotating again", async () => {
    // Landscape (956 px) is the tablet layout, with Semana.
    const viewport = mockPhoneViewport("landscape");
    setNow(new Date(2026, 9, 14, 7, 0));
    renderTab([]);
    expect(screen.getByRole("button", { name: "Semana" })).toHaveAttribute("aria-pressed", "true");

    act(() => viewport.rotate("portrait"));
    expect(screen.queryByRole("button", { name: "Semana" })).toBeNull();
    expect(screen.getByRole("button", { name: "Día" })).toHaveAttribute("aria-pressed", "true");

    act(() => viewport.rotate("landscape"));
    expect(await screen.findByRole("button", { name: "Semana" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Día" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("CalendarTab past visits from the paper agenda", () => {
  beforeEach(() => stubBookingCatalog());

  it('"Registrar cita pasada" opens the form and a saved visit reloads the calendar', async () => {
    setNow(new Date(2026, 9, 15, 11, 10));
    supabaseMock.onRpc("staff_record_past_visit", { data: "a-past" });
    const { user, onDataChange } = renderTab([]);

    await user.click(screen.getByRole("button", { name: "Registrar cita pasada" }));
    expect(await screen.findByRole("heading", { name: "Registrar cita pasada" })).toBeInTheDocument();
    await screen.findByRole("combobox", { name: "Paciente" });

    await pickDropdownOption(user, "Paciente", "Marta López");
    await pickDropdownOption(user, "Servicio", "Toxina · $1,000.00");
    await pickDropdownOption(user, "Hora", "09:00 AM");
    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    await user.click(screen.getByRole("button", { name: "Guardar cita pasada" }));

    await waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    expect(supabaseMock.lastRpc("staff_record_past_visit")?.args).toMatchObject({
      p_patient_id: "p-marta",
      p_service_id: "srv-toxina",
      p_start_time: "2026-10-15T15:00:00.000Z",
      p_amount: 1000,
    });
    // "Agendar Cita" (future bookings only) was never used.
    expect(supabaseMock.rpcCalls("staff_create_appointment")).toHaveLength(0);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Registrar cita pasada" })).toBeNull(),
    );
  });

  it("shows a past visit (completed, no note) in the calendar without the red supplies flag", () => {
    setNow(new Date(2026, 9, 16, 12, 0));
    renderTab([appt({ status: "completed", suppliesPending: false })]);

    const card = screen.getByText("Ana Pérez").closest("div.cursor-pointer")!;
    expect(card).not.toHaveClass("bg-rose-50");
    expect(screen.queryByText("Sin insumos")).toBeNull();
  });
});
