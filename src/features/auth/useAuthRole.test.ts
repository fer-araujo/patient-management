import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { makeSession, supabaseMock } from "../../test/supabaseMock";
import {
  isBusinessRole,
  isDoctorRole,
  isStaffRole,
  useAuthRole,
  type AppRole,
} from "./useAuthRole";

describe("isDoctorRole (Centro Clínico)", () => {
  it.each<[AppRole | null, boolean]>([
    ["doctor", true],
    ["admin", false],
    ["patient", false],
    [null, false],
  ])("isDoctorRole(%s) is %s", (role, expected) => {
    expect(isDoctorRole(role)).toBe(expected);
  });
});

describe("isBusinessRole (Administración)", () => {
  it.each<[AppRole | null, boolean]>([
    ["doctor", true],
    ["admin", true],
    ["patient", false],
    [null, false],
  ])("isBusinessRole(%s) is %s", (role, expected) => {
    expect(isBusinessRole(role)).toBe(expected);
  });
});

describe("isStaffRole", () => {
  it.each<[AppRole | null, boolean]>([
    ["doctor", true],
    ["admin", true],
    ["patient", false],
    [null, false],
  ])("isStaffRole(%s) is %s", (role, expected) => {
    expect(isStaffRole(role)).toBe(expected);
  });
});

describe("useAuthRole", () => {
  it("resolves to no session and no role when signed out", async () => {
    const { result } = renderHook(() => useAuthRole());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toMatchObject({
      session: null,
      role: null,
      loading: false,
      roleError: false,
    });
    expect(supabaseMock.client.from).not.toHaveBeenCalled();
  });

  it("reads the role from the caller's own profiles row", async () => {
    const session = makeSession("user-doc");
    supabaseMock.setSession(session);
    supabaseMock.onFrom("profiles", { data: { role: "doctor" } });

    const { result } = renderHook(() => useAuthRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.session).toBe(session);
    expect(result.current.role).toBe("doctor");

    const query = supabaseMock.queries("profiles")[0];
    expect(query.args("select")).toEqual(["role"]);
    expect(query.args("eq")).toEqual(["id", "user-doc"]);
    expect(query.has("maybeSingle")).toBe(true);
  });

  it("ignores any role claimed in the session's user metadata", async () => {
    const session = makeSession("user-patient", { phone: "525512345678" });
    session.user.user_metadata = { role: "admin" };
    session.user.app_metadata = { role: "admin" };
    supabaseMock.setSession(session);
    supabaseMock.onFrom("profiles", { data: { role: "patient" } });

    const { result } = renderHook(() => useAuthRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBe("patient");
  });

  it("resolves to no role, without an error, when the profile row is missing", async () => {
    supabaseMock.setSession(makeSession("user-x"));
    supabaseMock.onFrom("profiles", { data: null });

    const { result } = renderHook(() => useAuthRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.session).not.toBeNull();
    expect(result.current.role).toBeNull();
    expect(result.current.roleError).toBe(false);
  });

  it("flags a failed role read as an error (not as 'not staff') and reads it again on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.setSession(makeSession("user-x"));
    supabaseMock.onFrom(
      "profiles",
      { error: { message: "network down" } },
      { data: { role: "doctor" } },
    );

    const { result } = renderHook(() => useAuthRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.session).not.toBeNull();
    expect(result.current.role).toBeNull();
    expect(result.current.roleError).toBe(true);

    act(() => result.current.retryRole());

    await waitFor(() => expect(result.current.role).toBe("doctor"));
    expect(result.current.roleError).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(supabaseMock.queries("profiles")).toHaveLength(2);
  });

  it("re-resolves the role when the auth state changes", async () => {
    supabaseMock.onFrom("profiles", { data: { role: "patient" } });

    const { result } = renderHook(() => useAuthRole());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.role).toBeNull();

    act(() => {
      supabaseMock.emitAuthChange("SIGNED_IN", makeSession("user-p"));
    });
    await waitFor(() => expect(result.current.role).toBe("patient"));
    expect(result.current.loading).toBe(false);

    act(() => {
      supabaseMock.emitAuthChange("SIGNED_OUT", null);
    });
    await waitFor(() => expect(result.current.session).toBeNull());
    expect(result.current.role).toBeNull();
  });

  it("keeps the last known role when a background re-read for the same user fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.setSession(makeSession("doctor-user"));
    supabaseMock.onFrom(
      "profiles",
      { data: { role: "doctor" } },
      { error: { message: "network down" } },
    );

    const { result } = renderHook(() => useAuthRole());
    await waitFor(() => expect(result.current.role).toBe("doctor"));

    // Token refresh for the same user: the re-read fails.
    act(() => {
      supabaseMock.emitAuthChange("TOKEN_REFRESHED", makeSession("doctor-user"));
    });
    // No "checking access" flash while it re-reads in the background.
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(supabaseMock.queries("profiles")).toHaveLength(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.role).toBe("doctor");
    expect(result.current.roleError).toBe(false);
  });

  it("does not carry a known role over to a different user whose read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.setSession(makeSession("doctor-user"));
    supabaseMock.onFrom(
      "profiles",
      { data: { role: "doctor" } },
      { error: { message: "network down" } },
    );

    const { result } = renderHook(() => useAuthRole());
    await waitFor(() => expect(result.current.role).toBe("doctor"));

    act(() => {
      supabaseMock.emitAuthChange("SIGNED_IN", makeSession("other-user"));
    });
    await waitFor(() => expect(result.current.roleError).toBe(true));
    expect(result.current.role).toBeNull();
  });

  it("unsubscribes from auth changes on unmount", async () => {
    const { result, unmount } = renderHook(() => useAuthRole());
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(supabaseMock.authUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
