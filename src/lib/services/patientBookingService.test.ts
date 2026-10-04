import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  acceptPrivacyNotice,
  cancelMyAppointment,
  createMyAppointment,
  fetchMyBookingProfile,
  registerMe,
  rescheduleMyAppointment,
  type MyRegistration,
} from "./patientBookingService";

const registration = (over: Partial<MyRegistration> = {}): MyRegistration => ({
  fullName: "  María   López García ",
  email: "maria@example.com",
  birthYear: "1975",
  referredBy: "Laura",
  privacyNoticeVersion: "2026-09-23",
  ...over,
});

const serverError = (message: string, code = "P0001") => ({
  error: { message, code, details: "", hint: "" },
});

// The services log failures on purpose; keep the test output readable.
const silenceConsole = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("registerMe", () => {
  it("calls register_me with the split name, parsed year and notice version", async () => {
    supabaseMock.onRpc("register_me", { data: "patient-123" });

    await expect(registerMe(registration())).resolves.toBe("patient-123");

    expect(supabaseMock.rpcCalls()).toHaveLength(1);
    const call = supabaseMock.lastRpc("register_me");
    expect(call?.args).toEqual({
      p_first_name: "María",
      p_last_name: "López García",
      p_email: "maria@example.com",
      p_referred_by: "Laura",
      p_dob_year: 1975,
      p_privacy_notice_version: "2026-09-23",
      p_user_agent: navigator.userAgent,
    });
  });

  it("never sends a phone: the server takes it from the verified session", async () => {
    supabaseMock.onRpc("register_me", { data: "patient-123" });

    await registerMe(registration());

    const args = supabaseMock.lastRpc("register_me")?.args ?? {};
    expect(Object.keys(args).some((key) => /phone|tel/i.test(key))).toBe(false);
    expect(JSON.stringify(args)).not.toMatch(/\+?52\d{10}/);
  });

  it("sends nulls for optional blanks and a placeholder last name", async () => {
    supabaseMock.onRpc("register_me", { data: "patient-123" });

    await registerMe(
      registration({ fullName: "Cher", email: "", referredBy: "", birthYear: "abc" }),
    );

    expect(supabaseMock.lastRpc("register_me")?.args).toMatchObject({
      p_first_name: "Cher",
      p_last_name: "Sin apellido",
      p_email: null,
      p_referred_by: null,
      p_dob_year: null,
    });
  });

  it("refuses to register without an accepted privacy notice and never calls the server", async () => {
    await expect(registerMe(registration({ privacyNoticeVersion: "" }))).rejects.toThrow(
      "Debes leer y aceptar el Aviso de Privacidad para continuar.",
    );
    expect(supabaseMock.client.rpc).not.toHaveBeenCalled();
  });

  it("surfaces the server's Spanish message for intentional (P0001) failures", async () => {
    silenceConsole();
    supabaseMock.onRpc(
      "register_me",
      serverError("Tu número no está verificado. Vuelve a ingresar el código."),
    );

    await expect(registerMe(registration())).rejects.toThrow(
      "Tu número no está verificado. Vuelve a ingresar el código.",
    );
  });

  it("hides internal database errors behind a generic message", async () => {
    silenceConsole();
    supabaseMock.onRpc(
      "register_me",
      serverError('duplicate key value violates unique constraint "x"', "23505"),
    );

    await expect(registerMe(registration())).rejects.toThrow(
      "No se pudo crear tu expediente.",
    );
  });
});

describe("createMyAppointment", () => {
  it("books through request_my_appointment with a UTC start time", async () => {
    supabaseMock.onRpc("request_my_appointment", { data: "appt-1" });

    await expect(
      createMyAppointment("service-1", "2026-10-15", "10:30 AM", "  Dolor de rodilla  "),
    ).resolves.toBe("appt-1");

    expect(supabaseMock.rpcCalls()).toHaveLength(1);
    expect(supabaseMock.lastRpc("request_my_appointment")?.args).toEqual({
      p_service_id: "service-1",
      // 10:30 AM in Monterrey (UTC-6).
      p_start_time: "2026-10-15T16:30:00.000Z",
      p_reason: "Dolor de rodilla",
    });
  });

  it("sends a null reason when the patient left it blank", async () => {
    await createMyAppointment("service-1", "2026-10-15", "12:00 PM", "   ");

    expect(supabaseMock.lastRpc("request_my_appointment")?.args).toMatchObject({
      p_start_time: "2026-10-15T18:00:00.000Z",
      p_reason: null,
    });
  });

  it("never identifies the patient from the browser", async () => {
    await createMyAppointment("service-1", "2026-10-15", "09:00 AM", "");

    const keys = Object.keys(supabaseMock.lastRpc("request_my_appointment")?.args ?? {});
    expect(keys).not.toContain("p_patient_id");
    expect(keys.some((k) => /phone/i.test(k))).toBe(false);
  });

  it("surfaces the server's Spanish error message", async () => {
    silenceConsole();
    supabaseMock.onRpc(
      "request_my_appointment",
      serverError("Ese horario ya no está disponible. Elige otro."),
    );

    await expect(
      createMyAppointment("service-1", "2026-10-15", "10:30 AM", ""),
    ).rejects.toThrow("Ese horario ya no está disponible. Elige otro.");
  });

  it("falls back to a generic message for non-intentional errors", async () => {
    silenceConsole();
    supabaseMock.onRpc("request_my_appointment", serverError("boom", "XX000"));

    await expect(
      createMyAppointment("service-1", "2026-10-15", "10:30 AM", ""),
    ).rejects.toThrow("No se pudo registrar tu cita.");
  });
});

describe("fetchMyBookingProfile", () => {
  it("maps the single row returned by get_my_booking_profile", async () => {
    supabaseMock.onRpc("get_my_booking_profile", {
      data: [{ is_registered: true, first_name: "Ana", needs_consent: false }],
    });

    await expect(fetchMyBookingProfile()).resolves.toEqual({
      isRegistered: true,
      firstName: "Ana",
      needsConsent: false,
    });
  });

  it("treats an empty answer as an unregistered caller who still needs consent", async () => {
    supabaseMock.onRpc("get_my_booking_profile", { data: [] });

    await expect(fetchMyBookingProfile()).resolves.toEqual({
      isRegistered: false,
      firstName: null,
      needsConsent: true,
    });
  });
});

describe("other patient RPCs", () => {
  it("records consent with the notice version and user agent", async () => {
    await acceptPrivacyNotice("2026-09-23");
    expect(supabaseMock.lastRpc("accept_privacy_notice")?.args).toEqual({
      p_privacy_notice_version: "2026-09-23",
      p_user_agent: navigator.userAgent,
    });
  });

  it("cancels and reschedules the caller's own appointment", async () => {
    await cancelMyAppointment("appt-1", "No puedo asistir");
    await rescheduleMyAppointment("appt-1", "2026-10-16T15:00:00.000Z");

    expect(supabaseMock.lastRpc("cancel_my_appointment")?.args).toEqual({
      p_appointment_id: "appt-1",
      p_reason: "No puedo asistir",
    });
    expect(supabaseMock.lastRpc("reschedule_my_appointment")?.args).toEqual({
      p_appointment_id: "appt-1",
      p_start_time: "2026-10-16T15:00:00.000Z",
    });
  });

  it("surfaces Spanish cancellation errors from the server", async () => {
    silenceConsole();
    supabaseMock.onRpc(
      "cancel_my_appointment",
      serverError("Solo puedes cancelar con 24 horas de anticipación."),
    );
    await expect(cancelMyAppointment("appt-1", "x")).rejects.toThrow(
      "Solo puedes cancelar con 24 horas de anticipación.",
    );
  });
});
