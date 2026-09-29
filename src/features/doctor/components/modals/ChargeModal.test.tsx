import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
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

describe("ChargeModal collecting only (onConfirm)", () => {
  it("hands the answer to onConfirm and never records the payment itself", async () => {
    const toastSuccess = vi.spyOn(toast, "success");
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { user, onSaved } = renderModal({ onConfirm });

    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    await user.type(screen.getByLabelText("Nota (opcional)"), "Pagó completo");
    await user.click(saveButton());

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        status: "paid",
        amount: 800,
        method: "cash",
        note: "Pagó completo",
      }),
    );
    expect(supabaseMock.rpcCalls("record_payment")).toHaveLength(0);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the rejection, stays open and can be retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("No se pudo finalizar la consulta."))
      .mockResolvedValueOnce(undefined);
    const { user, onClose } = renderModal({ onConfirm });

    await user.click(screen.getByRole("radio", { name: "Tarjeta" }));
    await user.click(saveButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("No se pudo finalizar la consulta."),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Cobro de la consulta")).toBeInTheDocument();

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });
});

describe("ChargeModal supplies used (withSupplies)", () => {
  const inventoryRow = (overrides: Record<string, unknown>) => ({
    category: "Insumos",
    min_alert_level: 1,
    last_restock_date: "2026-09-01",
    is_active: true,
    ...overrides,
  });

  const stubSupplies = () => {
    supabaseMock.onFrom("inventory", {
      data: [
        inventoryRow({ id: "item-s", name: "Sculptra", stock_quantity: 3, unit_measure: "viales" }),
        inventoryRow({ id: "item-j", name: "Jeringas", stock_quantity: 10, unit_measure: "piezas" }),
        inventoryRow({ id: "item-g", name: "Gasas", stock_quantity: 50, unit_measure: "paquetes" }),
        inventoryRow({ id: "item-old", name: "Toxina vieja", stock_quantity: 4, unit_measure: "viales", is_active: false }),
      ],
    });
    supabaseMock.onFrom("service_supplies", {
      data: [
        { item_id: "item-s", quantity: 1, inventory: { name: "Sculptra", unit_measure: "viales" } },
        { item_id: "item-j", quantity: 2, inventory: { name: "Jeringas", unit_measure: "piezas" } },
        { item_id: "item-old", quantity: 1, inventory: { name: "Toxina vieja", unit_measure: "viales" } },
      ],
    });
  };

  const renderWithSupplies = () => {
    stubSupplies();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const rendered = renderModal({
      onConfirm,
      withSupplies: true,
      serviceId: "svc-1",
      confirmLabel: "Guardar y finalizar",
    });
    return { ...rendered, onConfirm };
  };

  const confirmButton = () => screen.getByRole("button", { name: /Guardar y finalizar/ });
  const quantityOf = (name: string) => screen.getByLabelText(`Cantidad de ${name}`);

  it("pre-fills the service's supplies with the current stock of each", async () => {
    renderWithSupplies();

    expect(await screen.findByLabelText("Cantidad de Sculptra")).toHaveValue(1);
    expect(quantityOf("Jeringas")).toHaveValue(2);
    expect(screen.getByText("En inventario: 3")).toBeInTheDocument();
    expect(screen.getByText("En inventario: 10")).toBeInTheDocument();
    // An archived item cannot be used, so it is not pre-filled.
    expect(screen.queryByLabelText("Cantidad de Toxina vieja")).toBeNull();
    expect(supabaseMock.queries("service_supplies")[0].args("eq")).toEqual(["service_id", "svc-1"]);
  });

  it("blocks confirming while a quantity is above the stock, until it is corrected", async () => {
    const { user, onConfirm } = renderWithSupplies();
    await screen.findByLabelText("Cantidad de Sculptra");
    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    expect(confirmButton()).toBeEnabled();

    await user.clear(quantityOf("Sculptra"));
    await user.type(quantityOf("Sculptra"), "5");

    expect(screen.getByText("Solo hay 3 en inventario")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    await user.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();

    // 0 means "not used" and is left out of what is sent.
    await user.clear(quantityOf("Sculptra"));
    await user.type(quantityOf("Sculptra"), "0");
    expect(screen.queryByText("Solo hay 3 en inventario")).toBeNull();
    expect(confirmButton()).toBeEnabled();

    await user.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0].supplies).toEqual([{ itemId: "item-j", quantity: 2 }]);
  });

  it("can remove a supply and add another one before confirming", async () => {
    const { user, onConfirm } = renderWithSupplies();
    await screen.findByLabelText("Cantidad de Sculptra");

    await user.click(screen.getByRole("button", { name: "Quitar Jeringas" }));
    expect(screen.queryByLabelText("Cantidad de Jeringas")).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "Insumos usados" }));
    // Already listed and archived items are not offered.
    expect(screen.queryByRole("option", { name: "Sculptra" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Toxina vieja" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Gasas" }));
    await user.clear(screen.getByLabelText("Cantidad a agregar"));
    await user.type(screen.getByLabelText("Cantidad a agregar"), "2");
    await user.click(screen.getByRole("button", { name: /Agregar/ }));

    expect(quantityOf("Gasas")).toHaveValue(2);
    expect(screen.getByText("En inventario: 50")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Tarjeta" }));
    await user.click(confirmButton());

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        status: "paid",
        amount: 800,
        method: "card",
        note: "",
        supplies: [
          { itemId: "item-s", quantity: 1 },
          { itemId: "item-g", quantity: 2 },
        ],
      }),
    );
  });

  it("confirming with every supply removed sends an EMPTY list (the step was done)", async () => {
    const { user, onConfirm } = renderWithSupplies();
    await screen.findByLabelText("Cantidad de Sculptra");

    await user.click(screen.getByRole("button", { name: "Quitar Sculptra" }));
    await user.click(screen.getByRole("button", { name: "Quitar Jeringas" }));
    expect(screen.getByText("Sin insumos anotados.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "No cobré (cortesía)" }));
    await user.click(confirmButton());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0].supplies).toEqual([]);
  });

  it("when the inventory does not load, she can still finalize and the supplies stay pending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("inventory", { error: { message: "boom" } });
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { user } = renderModal({
      onConfirm,
      withSupplies: true,
      serviceId: "svc-1",
      confirmLabel: "Guardar y finalizar",
    });

    expect(await screen.findByText(/No se pudieron cargar los insumos/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Efectivo" }));
    await user.click(confirmButton());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // No "supplies" at all: the server leaves the consultation unmarked, so
    // the calendar shows it in red to record them later.
    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty("supplies");
  });

  it("the calendar's charge (no supplies) never loads the inventory", () => {
    renderModal();
    expect(screen.queryByText("Insumos usados")).toBeNull();
    expect(supabaseMock.queries("inventory")).toHaveLength(0);
    expect(supabaseMock.queries("service_supplies")).toHaveLength(0);
  });
});
