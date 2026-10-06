import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { supabaseMock } from "../../../test/supabaseMock";
import { ClinicModeProvider } from "../../clinicMode/ClinicModeProvider";
import { ClinicModeSwitch } from "./ClinicModeSwitch";

const renderSwitch = async (initial: boolean) => {
  supabaseMock.onRpc("get_clinic_mode", { data: initial });
  render(
    <ClinicModeProvider>
      <ClinicModeSwitch />
    </ClinicModeProvider>,
  );
  const toggle = screen.getByRole("switch", { name: "Modo solo doctora" });
  await waitFor(() => expect(toggle).toBeEnabled());
  return { toggle, user: userEvent.setup() };
};

describe("ClinicModeSwitch", () => {
  it("shows the current mode with a text label, not only a color", async () => {
    const { toggle } = await renderSwitch(false);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveTextContent("Desactivado");
  });

  it("asks for confirmation, explaining what patients lose, before turning it on", async () => {
    const success = vi.spyOn(toast, "success");
    supabaseMock.onRpc("set_clinic_mode", { data: true });
    const { toggle, user } = await renderSwitch(false);

    await user.click(toggle);

    expect(screen.getByText("Activar modo solo doctora")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Los pacientes no podrán reservar en línea ni entrar al portal. Las citas las registras tú.",
      ),
    ).toBeInTheDocument();
    // Nothing changes until she confirms.
    expect(supabaseMock.rpcCalls("set_clinic_mode")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Sí, activar" }));

    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(supabaseMock.lastRpc("set_clinic_mode")?.args).toEqual({ p_doctor_only: true });
    expect(toggle).toHaveTextContent("Activado");
    expect(success).toHaveBeenCalledWith("Modo solo doctora activado.");
    await waitFor(() =>
      expect(screen.queryByText("Activar modo solo doctora")).not.toBeInTheDocument(),
    );
  });

  it("changes nothing when she cancels", async () => {
    const { toggle, user } = await renderSwitch(false);

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(supabaseMock.rpcCalls("set_clinic_mode")).toHaveLength(0);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("turns it off with its own confirmation", async () => {
    supabaseMock.onRpc("set_clinic_mode", { data: false });
    const { toggle, user } = await renderSwitch(true);
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    expect(screen.getByText("Desactivar modo solo doctora")).toBeInTheDocument();
    expect(
      screen.getByText("Los pacientes podrán volver a reservar en línea y entrar a su portal."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sí, desactivar" }));

    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(supabaseMock.lastRpc("set_clinic_mode")?.args).toEqual({ p_doctor_only: false });
  });

  it("keeps the mode and explains why when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = vi.spyOn(toast, "error");
    supabaseMock.onRpc("set_clinic_mode", {
      error: { message: "permission denied", code: "42501" },
    });
    const { toggle, user } = await renderSwitch(false);

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Sí, activar" }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("No tienes permisos para cambiar el modo de la clínica."),
    );
    expect(toggle).toHaveAttribute("aria-checked", "false");
    // The dialog stays open so she can retry or cancel.
    expect(screen.getByText("Activar modo solo doctora")).toBeInTheDocument();
  });

  it("says the mode is unknown and offers a retry when it cannot be read, never a false Desactivado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("get_clinic_mode", { error: { message: "offline", code: "500" } });
    render(
      <ClinicModeProvider retryDelayMs={0}>
        <ClinicModeSwitch />
      </ClinicModeProvider>,
    );

    expect(await screen.findByText("No se pudo leer el modo")).toBeInTheDocument();
    // The first read and two retries.
    expect(supabaseMock.rpcCalls("get_clinic_mode")).toHaveLength(3);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText("Desactivado")).not.toBeInTheDocument();

    supabaseMock.onRpc("get_clinic_mode", { data: true });
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    const toggle = await screen.findByRole("switch", { name: "Modo solo doctora" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(toggle).toHaveTextContent("Activado");
    expect(screen.queryByText("No se pudo leer el modo")).not.toBeInTheDocument();
  });

  it("recovers silently when a retry succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    supabaseMock.onRpc("get_clinic_mode", () =>
      ++calls === 1 ? { error: { message: "offline", code: "500" } } : { data: true },
    );
    render(
      <ClinicModeProvider retryDelayMs={0}>
        <ClinicModeSwitch />
      </ClinicModeProvider>,
    );

    const toggle = await screen.findByRole("switch", { name: "Modo solo doctora" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(supabaseMock.rpcCalls("get_clinic_mode")).toHaveLength(2);
    expect(screen.queryByText("No se pudo leer el modo")).not.toBeInTheDocument();
  });
});
