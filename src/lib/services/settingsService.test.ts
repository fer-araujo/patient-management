import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  CLINIC_MODE_TIMEOUT_MS,
  fetchClinicMode,
  updateClinicMode,
} from "./settingsService";

describe("fetchClinicMode", () => {
  it("reads the doctor-only mode through the public RPC", async () => {
    supabaseMock.onRpc("get_clinic_mode", { data: true });
    await expect(fetchClinicMode()).resolves.toBe(true);
    expect(supabaseMock.rpcCalls("get_clinic_mode")).toHaveLength(1);
    // Never the staff-only table.
    expect(supabaseMock.queries("clinic_settings")).toHaveLength(0);
  });

  it("is off unless the server says exactly true", async () => {
    supabaseMock.onRpc("get_clinic_mode", { data: null });
    await expect(fetchClinicMode()).resolves.toBe(false);
  });

  it("throws a Spanish message when it cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("get_clinic_mode", { error: { message: "boom", code: "500" } });
    await expect(fetchClinicMode()).rejects.toThrow("No se pudo consultar el modo de la clínica.");
  });
});

describe("fetchClinicMode timeout", () => {
  it("aborts a stalled read and fails into the normal error path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    // The server never answers.
    supabaseMock.onRpc("get_clinic_mode", () => new Promise(() => {}));

    const read = fetchClinicMode();
    const settled = expect(read).rejects.toThrow("No se pudo consultar el modo de la clínica.");
    await vi.advanceTimersByTimeAsync(CLINIC_MODE_TIMEOUT_MS);
    await settled;

    const signal = supabaseMock
      .queries("rpc:get_clinic_mode")[0]
      .args("abortSignal")?.[0] as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  it("does not fail a read that answers in time", async () => {
    vi.useFakeTimers();
    supabaseMock.onRpc("get_clinic_mode", { data: true });

    await expect(fetchClinicMode()).resolves.toBe(true);
    // The timer was cleared: nothing left to fire later.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("updateClinicMode", () => {
  it("sends the new mode to set_clinic_mode and returns what the server stored", async () => {
    supabaseMock.onRpc("set_clinic_mode", { data: true });
    await expect(updateClinicMode(true)).resolves.toBe(true);
    expect(supabaseMock.lastRpc("set_clinic_mode")?.args).toEqual({ p_doctor_only: true });
  });

  it("explains a permission refusal (admin or patient) in Spanish", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("set_clinic_mode", {
      error: { message: "permission denied for function set_clinic_mode", code: "42501" },
    });
    await expect(updateClinicMode(false)).rejects.toThrow(
      "No tienes permisos para cambiar el modo de la clínica.",
    );
  });

  it("passes the server's Spanish P0001 message through, and hides anything else", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("set_clinic_mode", {
      error: { message: "Indica si el modo solo doctora queda activado o desactivado.", code: "P0001" },
    });
    await expect(updateClinicMode(true)).rejects.toThrow(
      "Indica si el modo solo doctora queda activado o desactivado.",
    );

    supabaseMock.onRpc("set_clinic_mode", { error: { message: "internal", code: "XX000" } });
    await expect(updateClinicMode(true)).rejects.toThrow("No se pudo cambiar el modo de la clínica.");
  });
});
