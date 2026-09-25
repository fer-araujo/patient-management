import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import type { Payment } from "../../../../lib/services/financeService";
import { ChargeModal } from "./ChargeModal";

const storedRow = (overrides: Record<string, unknown> = {}) => ({
  id: "pay-1",
  appointment_id: "appt-1",
  patient_id: "patient-1",
  service_id: "svc-1",
  list_price: "800.00",
  amount_charged: "800.00",
  status: "paid",
  method: "cash",
  note: null,
  created_at: "2026-09-10T16:00:00+00:00",
  updated_at: "2026-09-10T16:00:00+00:00",
  ...overrides,
});

const renderModal = (props: Partial<Parameters<typeof ChargeModal>[0]> = {}) => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <ChargeModal
      isOpen
      onClose={onClose}
      onSaved={onSaved}
      appointmentId="appt-1"
      servicePrice={800}
      {...props}
    />,
  );
  return { onClose, onSaved, user: userEvent.setup() };
};

const amountInput = () => screen.queryByLabelText("¿Cuánto cobraste? (MXN)");
const saveButton = () => screen.getByRole("button", { name: /Guardar cobro/ });

describe("ChargeModal", () => {
  it('starts on "Sí, cobré" with the service price pre-filled', () => {
    renderModal();

    expect(screen.getByRole("radio", { name: "Sí, cobré" })).toHaveAttribute("aria-checked", "true");
    expect(amountInput()).toHaveValue(800);
    expect(screen.getByRole("radio", { name: "Efectivo" })).toHaveAttribute("aria-checked", "false");
  });

  it("leaves the amount empty when the service has no price", () => {
    renderModal({ servicePrice: null });
    expect(amountInput()).toHaveValue(null);
  });

  it("needs an amount above 0 and a payment method before saving", async () => {
    const { user } = renderModal();
    expect(saveButton()).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Tarjeta" }));
    expect(saveButton()).toBeEnabled();

    await user.clear(amountInput()!);
    expect(saveButton()).toBeDisabled();
    await user.type(amountInput()!, "0");
    expect(saveButton()).toBeDisabled();
    await user.clear(amountInput()!);
    await user.type(amountInput()!, "650");
    expect(saveButton()).toBeEnabled();
  });

  it("records a paid charge with the edited amount and the chosen method", async () => {
    supabaseMock.onRpc("record_payment", { data: storedRow({ amount_charged: "650.00", method: "transfer" }) });
    const { user, onSaved } = renderModal();

    await user.clear(amountInput()!);
    await user.type(amountInput()!, "650");
    await user.click(screen.getByRole("radio", { name: "Transferencia" }));
    await user.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(supabaseMock.lastRpc("record_payment")?.args).toEqual({
      p_appointment_id: "appt-1",
      p_status: "paid",
      p_amount: 650,
      p_method: "transfer",
      p_note: null,
    });
    expect(onSaved.mock.calls[0][0]).toMatchObject({ amountCharged: 650, method: "transfer" });
  });

  it("a courtesy hides the amount and the method and saves as free", async () => {
    supabaseMock.onRpc("record_payment", {
      data: storedRow({ status: "courtesy", amount_charged: "0.00", method: null }),
    });
    const { user, onSaved } = renderModal();

    await user.click(screen.getByRole("radio", { name: "No cobré (cortesía)" }));

    expect(amountInput()).toBeNull();
    expect(screen.queryByRole("radio", { name: "Efectivo" })).toBeNull();
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(supabaseMock.lastRpc("record_payment")?.args).toMatchObject({
      p_status: "courtesy",
      p_amount: 0,
      p_method: null,
    });
  });

  it("opens an existing charge with its own values", () => {
    const existing: Payment = {
      id: "pay-1",
      appointmentId: "appt-1",
      patientId: "patient-1",
      serviceId: "svc-1",
      listPrice: 800,
      amountCharged: 600,
      status: "paid",
      method: "card",
      note: "Descuento",
      createdAt: "2026-09-10T16:00:00+00:00",
      updatedAt: "2026-09-10T16:00:00+00:00",
    };
    renderModal({ existing });

    expect(amountInput()).toHaveValue(600);
    expect(screen.getByRole("radio", { name: "Tarjeta" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Descuento");
  });

  it("stays open and does not report success when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("record_payment", {
      error: { code: "P0001", message: "Esta cita está cancelada: no se puede registrar un cobro." },
    });
    const { user, onSaved, onClose } = renderModal();

    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    await user.click(saveButton());

    await waitFor(() => expect(supabaseMock.rpcCalls("record_payment")).toHaveLength(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Cobro de la consulta")).toBeInTheDocument();
  });
});
