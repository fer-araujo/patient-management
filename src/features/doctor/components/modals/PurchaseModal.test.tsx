import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import type { InventoryItem } from "../../../../lib/services/inventoryService";
import { PurchaseModal } from "./PurchaseModal";

const item: InventoryItem = {
  id: "i1",
  name: "Jeringa 3 ml",
  category: "Insumos",
  stock_quantity: 10,
  min_alert_level: 5,
  unit_measure: "piezas",
  last_restock_date: "2026-09-01",
  is_active: true,
};

const renderModal = () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<PurchaseModal isOpen onClose={onClose} onSaved={onSaved} item={item} />);
  return { onClose, onSaved, user: userEvent.setup() };
};

const unitCost = () => screen.getByTestId("purchase-unit-cost").textContent;

describe("PurchaseModal", () => {
  it("shows the cost per unit as the two fields are filled", async () => {
    const { user } = renderModal();
    expect(unitCost()).toBe("Costo por unidad: —");

    await user.type(screen.getByLabelText("¿Cuántas unidades compraste?"), "4");
    expect(unitCost()).toBe("Costo por unidad: —");

    await user.type(screen.getByLabelText("¿Cuánto pagaste en total? (MXN)"), "100");
    expect(unitCost()).toBe("Costo por unidad: $25.00");

    await user.clear(screen.getByLabelText("¿Cuántas unidades compraste?"));
    await user.type(screen.getByLabelText("¿Cuántas unidades compraste?"), "3");
    expect(unitCost()).toBe("Costo por unidad: $33.33");
  });

  it("keeps the save button disabled until both amounts are valid", async () => {
    const { user } = renderModal();
    const save = screen.getByRole("button", { name: /Registrar compra/ });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("¿Cuántas unidades compraste?"), "0");
    await user.type(screen.getByLabelText("¿Cuánto pagaste en total? (MXN)"), "50");
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText("¿Cuántas unidades compraste?"));
    await user.type(screen.getByLabelText("¿Cuántas unidades compraste?"), "2");
    expect(save).toBeEnabled();
  });

  it("registers the purchase through the ledger and reports the new stock", async () => {
    supabaseMock.onRpc("adjust_stock", { data: 14 });
    const { user, onSaved, onClose } = renderModal();

    await user.type(screen.getByLabelText("¿Cuántas unidades compraste?"), "4");
    await user.type(screen.getByLabelText("¿Cuánto pagaste en total? (MXN)"), "100");
    await user.type(screen.getByLabelText("Nota (opcional)"), "Factura 12");
    await user.click(screen.getByRole("button", { name: /Registrar compra/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("i1", 14));
    expect(onClose).toHaveBeenCalled();
    expect(supabaseMock.lastRpc("adjust_stock")?.args).toEqual({
      p_item_id: "i1",
      p_delta: 4,
      p_type: "purchase",
      p_total_cost: 100,
      p_note: "Factura 12",
    });
    expect(supabaseMock.queries("inventory")).toHaveLength(0);
  });

  it("keeps the modal open when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("adjust_stock", {
      error: { code: "P0001", message: "Este artículo está archivado. Reactívalo para mover su stock." },
    });
    const { user, onSaved, onClose } = renderModal();

    await user.type(screen.getByLabelText("¿Cuántas unidades compraste?"), "1");
    await user.type(screen.getByLabelText("¿Cuánto pagaste en total? (MXN)"), "10");
    await user.click(screen.getByRole("button", { name: /Registrar compra/ }));

    await waitFor(() => expect(supabaseMock.rpcCalls("adjust_stock")).toHaveLength(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
