import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import type { InventoryItem } from "../../../../lib/services/inventoryService";
import { InventoryTab } from "./InventoryTab";

const makeItem = (
  id: string,
  stock: number,
  min: number,
  extra: Partial<InventoryItem> = {},
): InventoryItem => ({
  id,
  name: `Artículo ${id}`,
  category: "Desechables",
  stock_quantity: stock,
  min_alert_level: min,
  unit_measure: "piezas",
  last_restock_date: "2026-09-01",
  is_active: true,
  ...extra,
});

const ITEMS: InventoryItem[] = [
  makeItem("agotado", 0, 5),
  makeItem("bajo1", 1, 5),
  makeItem("bajo5", 5, 5),
  makeItem("normal", 6, 5, { category: "Medicamentos" }),
  makeItem("archivado", 0, 5, { is_active: false }),
];

const renderTab = async (items: InventoryItem[] = ITEMS) => {
  supabaseMock.onFrom("inventory", { data: items });
  const onItemsChange = vi.fn();
  render(<InventoryTab onItemsChange={onItemsChange} />);
  await screen.findByText("Total Insumos");
  return { onItemsChange, user: userEvent.setup() };
};

const counter = (label: string) =>
  screen.getByText(label).nextElementSibling?.textContent;

const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

describe("InventoryTab stock rule", () => {
  it("counts 1..alert level as low and 0 as out of stock, active items only", async () => {
    await renderTab();

    expect(counter("Total Insumos")).toBe("4");
    expect(counter("Stock Bajo")).toBe("2");
    expect(counter("Agotados")).toBe("1");
  });

  it("marks each row with the same rule as the counters", async () => {
    await renderTab();

    expect(within(rowOf("Artículo agotado")).getByTitle("Agotado")).toBeInTheDocument();
    expect(within(rowOf("Artículo bajo1")).getByTitle("Stock bajo")).toBeInTheDocument();
    expect(within(rowOf("Artículo bajo5")).getByTitle("Stock bajo")).toBeInTheDocument();
    expect(within(rowOf("Artículo normal")).queryByTitle(/Agotado|Stock bajo/)).toBeNull();
  });

  it("reports the loaded items for the dashboard badge", async () => {
    const { onItemsChange } = await renderTab();
    await waitFor(() => expect(onItemsChange).toHaveBeenLastCalledWith(ITEMS));
  });
});

describe("InventoryTab quick adjust", () => {
  it("sends − as one unit used, never an absolute stock", async () => {
    supabaseMock.onRpc("adjust_stock", { data: 5 });
    const { user } = await renderTab();

    await user.click(within(rowOf("Artículo normal")).getByTitle("Restar unidad (uso)"));

    expect(supabaseMock.rpcCalls("adjust_stock").map((c) => c.args)).toEqual([
      { p_item_id: "normal", p_delta: -1, p_type: "use", p_total_cost: null, p_note: null },
    ]);
    const updates = supabaseMock.queries("inventory").filter((q) => q.has("update"));
    expect(updates).toHaveLength(0);
  });

  it("does not go below zero", async () => {
    const { user } = await renderTab();
    await user.click(within(rowOf("Artículo agotado")).getByTitle("Restar unidad (uso)"));
    expect(supabaseMock.rpcCalls("adjust_stock")).toHaveLength(0);
  });

  it("+ opens the add dialog at 1 and records a purchase with its cost", async () => {
    supabaseMock.onRpc("adjust_stock", { data: 7 });
    const { user } = await renderTab();

    await user.click(within(rowOf("Artículo normal")).getByTitle("Agregar unidades"));

    expect(await screen.findByText("Agregar unidades")).toBeInTheDocument();
    expect(screen.getByLabelText("¿Cuántas unidades compraste?")).toHaveValue(1);
    // The row cart buttons share the accessible name, so take the dialog's
    // submit by its visible text. A purchase cannot be saved without its cost.
    const submit = () => screen.getByText("Registrar compra").closest("button")!;
    expect(submit()).toBeDisabled();

    await user.type(screen.getByLabelText("¿Cuánto pagaste en total? (MXN)"), "80");
    await user.click(submit());

    await waitFor(() => expect(supabaseMock.rpcCalls("adjust_stock")).toHaveLength(1));
    expect(supabaseMock.rpcCalls("adjust_stock")[0].args).toMatchObject({
      p_item_id: "normal",
      p_delta: 1,
      p_type: "purchase",
      p_total_cost: 80,
    });
  });

  it("+ can record a counting correction without a cost", async () => {
    supabaseMock.onRpc("adjust_stock", { data: 9 });
    const { user } = await renderTab();

    await user.click(within(rowOf("Artículo normal")).getByTitle("Agregar unidades"));
    await user.click(await screen.findByRole("radio", { name: "No, es una corrección" }));

    expect(screen.queryByLabelText("¿Cuánto pagaste en total? (MXN)")).toBeNull();
    const quantity = screen.getByLabelText("¿Cuántas unidades agregas?");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(supabaseMock.rpcCalls("adjust_stock")).toHaveLength(1));
    expect(supabaseMock.rpcCalls("adjust_stock")[0].args).toMatchObject({
      p_item_id: "normal",
      p_delta: 3,
      p_type: "adjustment",
      p_total_cost: null,
    });
  });

  it("updates optimistically and rolls back when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("adjust_stock", {
      error: { code: "P0001", message: "No hay suficiente stock: quedan 0 unidades." },
    });
    const { user } = await renderTab();
    const row = rowOf("Artículo bajo1");

    await user.click(within(row).getByTitle("Restar unidad (uso)"));

    // Rolled back to 1 and still flagged as low, not out of stock.
    await waitFor(() => expect(within(row).getByTitle("Stock bajo")).toHaveTextContent("1"));
    expect(counter("Agotados")).toBe("1");
  });
});

describe("InventoryTab filters", () => {
  it("filters by status and by category", async () => {
    const { user } = await renderTab();

    // The filters are the app's Dropdown: click the trigger (it shows the
    // current label), then the option, which renders in a portal at the end
    // of <body>.
    // While the menu animates out, a label can appear twice: the trigger
    // comes first in the DOM, the portal option last.
    await user.click(screen.getByText("Todos"));
    await user.click(screen.getAllByText("Archivados").at(-1)!);
    expect(screen.getByText("Artículo archivado")).toBeInTheDocument();
    expect(screen.queryByText("Artículo normal")).toBeNull();

    await user.click(screen.getAllByText("Archivados")[0]);
    await user.click(screen.getAllByText("Activos").at(-1)!);
    expect(screen.queryByText("Artículo archivado")).toBeNull();

    await user.click(screen.getByText("Todas las categorías"));
    await user.click(screen.getAllByText("Medicamentos").at(-1)!);
    expect(screen.getByText("Artículo normal")).toBeInTheDocument();
    expect(screen.queryByText("Artículo bajo1")).toBeNull();
  });
});
