import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { supabaseMock } from "../../../../test/supabaseMock";
import { DEFAULT_SCHEDULE } from "../../../../lib/services/settingsService";
import type { DashboardAppointment } from "../../../../lib/services/clinicService";
import { getPastVisitTimeOptions } from "../../utils/calendarUtils";
import { PastVisitModal } from "./PastVisitModal";

// Thursday 15 Oct 2026, 11:10 AM in Monterrey (the suite's time zone).
// Default schedule: Mon-Fri 08:00 AM - 06:00 PM, Sunday closed.
const NOW = new Date(2026, 9, 15, 11, 10);

const patientRow = (id: string, firstName: string, lastName: string) => ({
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
});

const serviceRow = (id: string, name: string, durationMins: number, price: number) => ({
  id,
  name,
  category: "Tratamiento",
  description: "",
  duration_mins: durationMins,
  price,
  care_guide: "",
  is_active: true,
});

const appt = (over: Partial<DashboardAppointment>): DashboardAppointment => ({
  id: "a-1",
  patientId: "p-ana",
  patientName: "Ana Pérez",
  service: "Valoración",
  date: "15 oct 2026",
  time: "09:00 AM",
  phone: "+528100000000",
  isNewPatient: false,
  status: "completed",
  durationMins: 30,
  reason: null,
  ...over,
});

const renderModal = (appointments: DashboardAppointment[] = []) => {
  const onSaved = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <PastVisitModal
      isOpen={true}
      onClose={onClose}
      appointments={appointments}
      blockedSlots={[]}
      workingSchedule={DEFAULT_SCHEDULE}
      onSaved={onSaved}
    />,
  );
  return { user: userEvent.setup(), onSaved, onClose };
};

const combobox = (label: string) => screen.getByRole("combobox", { name: label });
const listbox = (label: string) => screen.getByRole("listbox", { name: label });

const pick = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) => {
  await user.click(combobox(label));
  await user.click(within(listbox(label)).getByRole("option", { name: option }));
};

const timeOptionNames = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(combobox("Hora"));
  const names = within(listbox("Hora"))
    .getAllByRole("option")
    .map((o) => o.textContent?.trim());
  await user.keyboard("{Escape}");
  return names;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  supabaseMock.onFrom("patients", {
    data: [patientRow("p-ana", "Ana", "Pérez"), patientRow("p-marta", "Marta", "López")],
  });
  supabaseMock.onFrom("services", {
    data: [serviceRow("srv-toxina", "Toxina", 30, 1200), serviceRow("srv-val", "Valoración", 60, 500)],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getPastVisitTimeOptions", () => {
  it("offers today only the times already started, and every free time of a past day", () => {
    const today = getPastVisitTimeOptions("2026-10-15", [], [], DEFAULT_SCHEDULE, 30, NOW.getTime());
    expect(today[0].value).toBe("08:00 AM");
    expect(today.at(-1)?.value).toBe("11:00 AM");
    expect(today.map((t) => t.value)).not.toContain("11:15 AM");

    const yesterday = getPastVisitTimeOptions("2026-10-14", [], [], DEFAULT_SCHEDULE, 30, NOW.getTime());
    expect(yesterday[0].value).toBe("08:00 AM");
    // A 30-minute visit must end by the 06:00 PM closing.
    expect(yesterday.at(-1)?.value).toBe("05:30 PM");
  });

  it("skips times taken by a visit already recorded that day", () => {
    const options = getPastVisitTimeOptions(
      "2026-10-15",
      [appt({ time: "09:00 AM", durationMins: 30 })],
      [],
      DEFAULT_SCHEDULE,
      30,
      NOW.getTime(),
    ).map((t) => t.value);
    expect(options).not.toContain("09:00 AM");
    expect(options).not.toContain("08:45 AM");
    expect(options).toContain("09:30 AM");
  });

  it("offers nothing on a closed day", () => {
    // Sunday 11 Oct 2026.
    expect(getPastVisitTimeOptions("2026-10-11", [], [], DEFAULT_SCHEDULE, 30, NOW.getTime())).toEqual([]);
  });
});

describe("PastVisitModal", () => {
  it("starts on today, with only the times already passed", async () => {
    const { user } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    expect(screen.getByLabelText("Fecha")).toHaveTextContent(/jueves, 15 de octubre de 2026/i);
    const times = await timeOptionNames(user);
    expect(times).toContain("11:00 AM");
    expect(times).not.toContain("11:15 AM");
    expect(times).not.toContain("05:30 PM");
  });

  it("keeps Guardar disabled until patient, service, time, amount and method are set", async () => {
    const { user } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });
    const save = screen.getByRole("button", { name: "Guardar cita pasada" });
    const saveAnother = screen.getByRole("button", { name: "Guardar y registrar otra" });

    expect(save).toBeDisabled();
    await pick(user, "Paciente", "Ana Pérez");
    await pick(user, "Servicio", "Toxina · $1,200.00");
    await pick(user, "Hora", "10:00 AM");
    // Paid by default: the amount comes from the list price, the method is missing.
    expect(screen.getByLabelText("Monto (MXN)")).toHaveValue(1200);
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    expect(save).toBeEnabled();
    expect(saveAnother).toBeEnabled();

    await user.clear(screen.getByLabelText("Monto (MXN)"));
    expect(save).toBeDisabled();
  });

  it("saves a paid visit with the edited amount and closes", async () => {
    supabaseMock.onRpc("staff_record_past_visit", { data: "appt-new" });
    const { user, onSaved, onClose } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    await pick(user, "Paciente", "Marta López");
    await pick(user, "Servicio", "Toxina · $1,200.00");
    await pick(user, "Hora", "08:30 AM");
    const amount = screen.getByLabelText("Monto (MXN)");
    await user.clear(amount);
    await user.type(amount, "1000");
    await user.click(screen.getByRole("radio", { name: "Transferencia" }));
    await user.type(screen.getByLabelText("Nota (opcional)"), "Pagó la mitad");
    await user.click(screen.getByRole("button", { name: "Guardar cita pasada" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(supabaseMock.lastRpc("staff_record_past_visit")?.args).toEqual({
      p_patient_id: "p-marta",
      p_service_id: "srv-toxina",
      // 08:30 AM in Monterrey (UTC-6).
      p_start_time: "2026-10-15T14:30:00.000Z",
      p_payment_status: "paid",
      p_amount: 1000,
      p_method: "transfer",
      p_note: "Pagó la mitad",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("keeps the clinical note collapsed and optional: without it no note is sent", async () => {
    supabaseMock.onRpc("staff_record_past_visit", { data: "appt-new" });
    const { user } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    const toggle = screen.getByRole("button", { name: "Nota clínica (opcional)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("A - Diagnóstico (Análisis)")).toBeNull();

    await pick(user, "Paciente", "Ana Pérez");
    await pick(user, "Servicio", "Valoración · $500.00");
    await pick(user, "Hora", "09:00 AM");
    await user.click(screen.getByRole("radio", { name: "Cortesía" }));
    await user.click(screen.getByRole("button", { name: "Guardar cita pasada" }));

    await waitFor(() => expect(supabaseMock.rpcCalls("staff_record_past_visit")).toHaveLength(1));
    expect(supabaseMock.rpcCalls("staff_record_past_visit_with_note")).toHaveLength(0);
  });

  it("saves the clinical note (S, O, A, prognosis, P, vital signs) with the visit in one call", async () => {
    supabaseMock.onRpc("staff_record_past_visit_with_note", { data: "appt-note" });
    const { user, onClose } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    await pick(user, "Paciente", "Ana Pérez");
    await pick(user, "Servicio", "Valoración · $500.00");
    await pick(user, "Hora", "09:00 AM");
    await user.click(screen.getByRole("radio", { name: "Cortesía" }));

    await user.click(screen.getByRole("button", { name: "Nota clínica (opcional)" }));
    expect(screen.getByRole("button", { name: "Nota clínica (opcional)" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.type(screen.getByLabelText("S - Motivo y Síntomas"), "Dolor lumbar");
    await user.type(screen.getByLabelText("A - Diagnóstico (Análisis)"), "Lumbalgia");
    await user.type(screen.getByLabelText("P - Tratamiento (Plan)"), "Reposo");
    await user.type(screen.getByLabelText("Presión sistólica"), "120");
    await user.type(screen.getByLabelText("Presión diastólica"), "80");
    await user.click(screen.getByRole("button", { name: "Guardar cita pasada" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(supabaseMock.rpcCalls("staff_record_past_visit")).toHaveLength(0);
    expect(supabaseMock.lastRpc("staff_record_past_visit_with_note")?.args).toMatchObject({
      p_patient_id: "p-ana",
      p_payment_status: "courtesy",
      p_subjective: "Dolor lumbar",
      p_objective: null,
      p_analysis: "Lumbalgia",
      p_prognosis: null,
      p_plan: "Reposo",
      p_vital_signs: { bp_sys: 120, bp_dia: 80 },
    });
  });

  it("does not save an impossible vital sign in the clinical note", async () => {
    const toastError = vi.spyOn(toast, "error");
    const { user } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    await pick(user, "Paciente", "Ana Pérez");
    await pick(user, "Servicio", "Valoración · $500.00");
    await pick(user, "Hora", "09:00 AM");
    await user.click(screen.getByRole("radio", { name: "Cortesía" }));
    await user.click(screen.getByRole("button", { name: "Nota clínica (opcional)" }));
    await user.type(screen.getByLabelText("Presión sistólica"), "120");
    await user.click(screen.getByRole("button", { name: "Guardar cita pasada" }));

    expect(toastError).toHaveBeenCalledWith("Escribe las dos cifras de la presión arterial.");
    expect(supabaseMock.rpcCalls("staff_record_past_visit")).toHaveLength(0);
    expect(supabaseMock.rpcCalls("staff_record_past_visit_with_note")).toHaveLength(0);
  });

  it("records a courtesy without amount or method", async () => {
    supabaseMock.onRpc("staff_record_past_visit", { data: "appt-new" });
    const { user } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    await pick(user, "Paciente", "Ana Pérez");
    await pick(user, "Servicio", "Valoración · $500.00");
    await pick(user, "Hora", "09:00 AM");
    await user.click(screen.getByRole("radio", { name: "Cortesía" }));
    expect(screen.queryByLabelText("Monto (MXN)")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Efectivo" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Guardar cita pasada" }));

    await waitFor(() =>
      expect(supabaseMock.lastRpc("staff_record_past_visit")?.args).toMatchObject({
        p_payment_status: "courtesy",
        p_amount: 0,
        p_method: null,
      }),
    );
  });

  it('"Guardar y registrar otra" stays open on the same day with an empty patient and service', async () => {
    supabaseMock.onRpc("staff_record_past_visit", { data: "appt-new" });
    const toastSuccess = vi.spyOn(toast, "success");
    const { user, onSaved, onClose } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    // A past day: yesterday.
    await user.click(screen.getByLabelText("Fecha"));
    await user.click(await screen.findByRole("button", { name: "14" }));
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.getByLabelText("Fecha")).toHaveTextContent(/miércoles, 14 de octubre de 2026/i);

    await pick(user, "Paciente", "Ana Pérez");
    await pick(user, "Servicio", "Toxina · $1,200.00");
    await pick(user, "Hora", "05:00 PM");
    await user.click(screen.getByRole("radio", { name: "Tarjeta" }));
    await user.click(screen.getByRole("button", { name: "Guardar y registrar otra" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Cita pasada guardada"));
    expect(supabaseMock.lastRpc("staff_record_past_visit")?.args).toMatchObject({
      p_patient_id: "p-ana",
      p_start_time: "2026-10-14T23:00:00.000Z",
      p_amount: 1200,
      p_method: "card",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    // Ready for the next line of the agenda page.
    expect(screen.getByText("1 cita guardada.")).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha")).toHaveTextContent(/14 de octubre/i);
    expect(combobox("Paciente")).toHaveTextContent("Buscar por nombre...");
    expect(combobox("Servicio")).toHaveTextContent("Seleccione un servicio...");
    expect(combobox("Hora")).toHaveTextContent("Seleccione una hora...");
    expect(screen.getByRole("button", { name: "Guardar cita pasada" })).toBeDisabled();
  });

  it("shows the server's refusal and keeps what was typed", async () => {
    supabaseMock.onRpc("staff_record_past_visit", {
      error: { message: "Ya hay una cita o un bloqueo en ese horario. Revisa la hora.", code: "P0001" },
    });
    const toastError = vi.spyOn(toast, "error");
    const { user, onClose } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    await pick(user, "Paciente", "Ana Pérez");
    await pick(user, "Servicio", "Toxina · $1,200.00");
    await pick(user, "Hora", "10:00 AM");
    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    await user.click(screen.getByRole("button", { name: "Guardar cita pasada" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Ya hay una cita o un bloqueo en ese horario. Revisa la hora.",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(combobox("Paciente")).toHaveTextContent("Ana Pérez");
  });

  it("creates a new patient without leaving and selects it", async () => {
    supabaseMock.onFrom("patients", (q) =>
      q.has("insert")
        ? { data: { id: "p-new" } }
        : {
            data: [
              patientRow("p-ana", "Ana", "Pérez"),
              patientRow("p-new", "Rosa", "Treviño"),
            ],
          },
    );
    supabaseMock.onRpc("record_consent_in_person", { data: true });
    const { user } = renderModal();
    await screen.findByRole("combobox", { name: "Paciente" });

    await user.click(screen.getByRole("button", { name: "+ Nuevo paciente" }));
    await user.type(await screen.findByPlaceholderText("Ej. María"), "Rosa");
    await user.type(screen.getByPlaceholderText("Ej. González"), "Treviño");
    await user.click(
      screen.getByRole("checkbox", { name: "El paciente firmó el aviso de privacidad en papel" }),
    );
    await user.click(screen.getByRole("button", { name: "Crear Expediente" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Crear Expediente" })).not.toBeInTheDocument(),
    );
    expect(supabaseMock.rpcCalls("record_consent_in_person")).toEqual([
      { name: "record_consent_in_person", args: { p_patient_id: "p-new" } },
    ]);
    await waitFor(() => expect(combobox("Paciente")).toHaveTextContent("Rosa Treviño"));
  });
});
