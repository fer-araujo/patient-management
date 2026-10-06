import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  adjustStock,
  computeUnitCost,
  countItemsNeedingRestock,
  createInventoryItem,
  fetchInventory,
  fetchMovements,
  getStockLevel,
  registerPurchase,
  toggleInventoryStatus,
  updateInventoryItem,
  type InventoryFormData,
  type InventoryItem,
} from "./inventoryService";

const form: InventoryFormData = {
  name: "Jeringa 3 ml",
  category: "Insumos",
  stock_quantity: 50,
  min_alert_level: 10,
  unit_measure: "pieza",
};

const item = (stock: number, min = 5, is_active = true): InventoryItem => ({
  id: `i-${stock}-${min}-${is_active}`,
  name: "Gasas",
  category: "Desechables",
  stock_quantity: stock,
  min_alert_level: min,
  unit_measure: "piezas",
  last_restock_date: "2026-09-01",
  is_active,
});

/** No test may write an absolute stock value to the inventory table. */
const expectNoDirectStockWrite = () => {
  for (const query of supabaseMock.queries("inventory")) {
    const update = query.args("update")?.[0] as Record<string, unknown> | undefined;
    expect(update ?? {}).not.toHaveProperty("stock_quantity");
    expect(update ?? {}).not.toHaveProperty("last_restock_date");
  }
};

describe("fetchInventory", () => {
  it("lists active items first, then by name (id as a stable tiebreaker for paging)", async () => {
    supabaseMock.onFrom("inventory", { data: [{ id: "i1" }] });

    await expect(fetchInventory()).resolves.toEqual([{ id: "i1" }]);

    const query = supabaseMock.queries("inventory")[0];
    expect(query.allArgs("order")).toEqual([
      ["is_active", { ascending: false }],
      ["name", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(query.args("range")).toEqual([0, 999]);
  });

  it("returns an empty list when there is no data", async () => {
    await expect(fetchInventory()).resolves.toEqual([]);
  });

  it("throws a Spanish message on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("inventory", { error: { message: "denied" } });
    await expect(fetchInventory()).rejects.toThrow("No se pudo cargar el inventario.");
  });
});

describe("inventory item writes", () => {
  it("creates new items as active, with their initial stock", async () => {
    await createInventoryItem(form);
    expect(supabaseMock.queries("inventory")[0].args("insert")).toEqual([
      { ...form, is_active: true },
    ]);
  });

  it("updates the descriptive fields only, never the stock", async () => {
    await updateInventoryItem("i1", {
      ...form,
      // A caller passing the whole form must still not write the stock.
      ...({ stock_quantity: 999 } as object),
    });
    const query = supabaseMock.queries("inventory")[0];
    expect(query.args("update")).toEqual([
      { name: form.name, category: form.category, min_alert_level: 10, unit_measure: "pieza" },
    ]);
    expect(query.args("eq")).toEqual(["id", "i1"]);
    expectNoDirectStockWrite();
  });

  it("flips the active flag", async () => {
    await toggleInventoryStatus("i1", true);
    expect(supabaseMock.queries("inventory")[0].args("update")).toEqual([{ is_active: false }]);
  });

  it.each([
    ["create", () => createInventoryItem(form), "Error al crear el artículo en el inventario."],
    ["update", () => updateInventoryItem("i1", form), "Error al actualizar el artículo."],
    ["toggle", () => toggleInventoryStatus("i1", false), "No se pudo cambiar el estado del artículo."],
  ])("reports a Spanish error when %s fails", async (_label, action, message) => {
    supabaseMock.onFrom("inventory", { error: { message: "denied" } });
    await expect(action()).rejects.toThrow(message);
  });
});

describe("adjustStock", () => {
  it("sends a signed delta to the adjust_stock RPC and returns the new stock", async () => {
    supabaseMock.onRpc("adjust_stock", { data: 9 });

    await expect(adjustStock("i1", -1, "adjustment")).resolves.toBe(9);

    expect(supabaseMock.rpcCalls()).toEqual([
      {
        name: "adjust_stock",
        args: { p_item_id: "i1", p_delta: -1, p_type: "adjustment", p_total_cost: null, p_note: null },
      },
    ]);
    expect(supabaseMock.queries("inventory")).toHaveLength(0);
  });

  it("trims the note and drops an empty one", async () => {
    await adjustStock("i1", 3, "adjustment", undefined, "  Ajuste manual  ");
    await adjustStock("i1", 3, "adjustment", undefined, "   ");
    expect(supabaseMock.rpcCalls("adjust_stock").map((c) => c.args?.p_note)).toEqual([
      "Ajuste manual",
      null,
    ]);
  });

  it.each([0, 1.5, Number.NaN])("rejects a delta of %s without calling the server", async (delta) => {
    await expect(adjustStock("i1", delta, "adjustment")).rejects.toThrow(
      "La cantidad debe ser un número entero distinto de cero.",
    );
    expect(supabaseMock.rpcCalls()).toHaveLength(0);
  });

  it("surfaces the database's Spanish message for business-rule failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("adjust_stock", {
      error: { code: "P0001", message: "No hay suficiente stock: quedan 0 unidades." },
    });
    await expect(adjustStock("i1", -1, "use")).rejects.toThrow(
      "No hay suficiente stock: quedan 0 unidades.",
    );
  });

  it("hides technical errors behind a Spanish fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("adjust_stock", {
      error: { code: "42501", message: "permission denied for function adjust_stock" },
    });
    await expect(adjustStock("i1", 1, "adjustment")).rejects.toThrow(
      "No se pudo actualizar la cantidad.",
    );
  });
});

describe("registerPurchase", () => {
  it("records a purchase with its total cost", async () => {
    supabaseMock.onRpc("adjust_stock", { data: 24 });

    await expect(registerPurchase("i1", 4, 100, "Factura 12")).resolves.toBe(24);

    expect(supabaseMock.lastRpc("adjust_stock")?.args).toEqual({
      p_item_id: "i1",
      p_delta: 4,
      p_type: "purchase",
      p_total_cost: 100,
      p_note: "Factura 12",
    });
    expectNoDirectStockWrite();
  });

  it("accepts a free purchase (total 0)", async () => {
    await registerPurchase("i1", 2, 0);
    expect(supabaseMock.lastRpc("adjust_stock")?.args?.p_total_cost).toBe(0);
  });

  it.each([
    [0, 100, "Indica cuántas unidades compraste (1 o más)."],
    [-3, 100, "Indica cuántas unidades compraste (1 o más)."],
    [2.5, 100, "Indica cuántas unidades compraste (1 o más)."],
    [4, -1, "Indica cuánto pagaste en total (0 o más)."],
    [4, Number.NaN, "Indica cuánto pagaste en total (0 o más)."],
  ])("rejects quantity %s / total %s before calling the server", async (quantity, total, message) => {
    await expect(registerPurchase("i1", quantity, total)).rejects.toThrow(message);
    expect(supabaseMock.rpcCalls()).toHaveLength(0);
  });
});

describe("fetchMovements", () => {
  it("lists one item's movements, newest first", async () => {
    supabaseMock.onFrom("inventory_movements", { data: [{ id: "m1" }] });

    await expect(fetchMovements("i1")).resolves.toEqual([{ id: "m1" }]);

    const query = supabaseMock.queries("inventory_movements")[0];
    expect(query.args("eq")).toEqual(["item_id", "i1"]);
    expect(query.args("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("throws a Spanish message on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("inventory_movements", { error: { message: "denied" } });
    await expect(fetchMovements("i1")).rejects.toThrow("No se pudo cargar el historial.");
  });
});

describe("stock rule", () => {
  it.each([
    [0, 5, "out"],
    [1, 5, "low"],
    [5, 5, "low"],
    [6, 5, "ok"],
    [0, 0, "out"],
    [1, 0, "ok"],
  ] as const)("stock %s with alert level %s is %s", (stock, min, level) => {
    expect(getStockLevel(item(stock, min))).toBe(level);
  });

  it("counts active items that are out of stock or low for the badge", () => {
    expect(
      countItemsNeedingRestock([item(0), item(3), item(20), item(0, 5, false), item(2, 5, false)]),
    ).toBe(2);
  });

  it("computes the unit cost rounded to cents", () => {
    expect(computeUnitCost(100, 4)).toBe(25);
    expect(computeUnitCost(100, 3)).toBe(33.33);
    expect(computeUnitCost(0, 5)).toBe(0);
    expect(computeUnitCost(100, 0)).toBeNull();
  });
});
