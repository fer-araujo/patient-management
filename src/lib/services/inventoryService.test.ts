import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  createInventoryItem,
  fetchInventory,
  toggleInventoryStatus,
  updateInventoryItem,
  updateItemStock,
  type InventoryFormData,
} from "./inventoryService";

const form: InventoryFormData = {
  name: "Jeringa 3 ml",
  category: "Insumos",
  stock_quantity: 50,
  min_alert_level: 10,
  unit_measure: "pieza",
};

describe("fetchInventory", () => {
  it("lists active items first, then by name", async () => {
    supabaseMock.onFrom("inventory", { data: [{ id: "i1" }] });

    await expect(fetchInventory()).resolves.toEqual([{ id: "i1" }]);

    const query = supabaseMock.queries("inventory")[0];
    expect(query.allArgs("order")).toEqual([
      ["is_active", { ascending: false }],
      ["name", { ascending: true }],
    ]);
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

describe("inventory writes", () => {
  it("creates new items as active", async () => {
    await createInventoryItem(form);
    expect(supabaseMock.queries("inventory")[0].args("insert")).toEqual([
      { ...form, is_active: true },
    ]);
  });

  it("updates an item by id", async () => {
    await updateInventoryItem("i1", form);
    const query = supabaseMock.queries("inventory")[0];
    expect(query.args("update")).toEqual([form]);
    expect(query.args("eq")).toEqual(["id", "i1"]);
  });

  it("sets the new stock and stamps the restock date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T18:00:00.000Z"));

    await updateItemStock("i1", 42);

    const query = supabaseMock.queries("inventory")[0];
    expect(query.args("update")).toEqual([
      { stock_quantity: 42, last_restock_date: "2026-09-24T18:00:00.000Z" },
    ]);
    expect(query.args("eq")).toEqual(["id", "i1"]);
  });

  it("flips the active flag", async () => {
    await toggleInventoryStatus("i1", true);
    expect(supabaseMock.queries("inventory")[0].args("update")).toEqual([{ is_active: false }]);
  });

  it.each([
    ["create", () => createInventoryItem(form), "Error al crear el artículo en el inventario."],
    ["update", () => updateInventoryItem("i1", form), "Error al actualizar el artículo."],
    ["stock", () => updateItemStock("i1", 1), "No se pudo actualizar la cantidad."],
    ["toggle", () => toggleInventoryStatus("i1", false), "No se pudo cambiar el estado del artículo."],
  ])("reports a Spanish error when %s fails", async (_label, action, message) => {
    supabaseMock.onFrom("inventory", { error: { message: "denied" } });
    await expect(action()).rejects.toThrow(message);
  });
});
