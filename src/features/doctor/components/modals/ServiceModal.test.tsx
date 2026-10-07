import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import {
  createInventoryItem,
  fetchInventory,
  type InventoryItem,
} from "../../../../lib/services/inventoryService";
import { ServiceModal } from "./ServiceModal";

vi.mock("react-hot-toast", () => {
  const toastFn = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  });
  return { default: toastFn, toast: toastFn };
});

vi.mock("../../../../lib/services/inventoryService", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../lib/services/inventoryService")
  >()),
  fetchInventory: vi.fn(),
  createInventoryItem: vi.fn(),
}));

const item = (id: string, name: string, unit = "piezas"): InventoryItem => ({
  id,
  name,
  category: "Insumos",
  stock_quantity: 20,
  min_alert_level: 1,
  unit_measure: unit,
  last_restock_date: "2026-09-01",
  is_active: true,
});

const OLD_LIST = [item("item-j", "Jeringas"), item("item-g", "Gasas", "paquetes")];
const NEW_ITEM = item("item-new", "Hilos PDO");
const NEW_LIST = [...OLD_LIST, NEW_ITEM];

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const modal = (isOpen: boolean) => (
  <ServiceModal isOpen={isOpen} onClose={() => {}} onSaved={() => {}} />
);

/** Opens "Nuevo insumo" and creates "Hilos PDO" (unit "piezas"). */
const createHilos = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: /^Insumos \(\d+\)$/ }));
  await user.click(screen.getByRole("button", { name: /Nuevo insumo/ }));
  await user.type(await screen.findByLabelText("Nombre del Artículo"), "Hilos PDO");
  await user.click(screen.getByRole("button", { name: /Crear Artículo/ }));
};

describe("ServiceModal: a supply created from the form", () => {
  it("tells the user when the list cannot be reloaded, and adds nothing", async () => {
    vi.mocked(fetchInventory)
      .mockResolvedValueOnce(OLD_LIST)
      .mockRejectedValueOnce(new Error("offline"));
    vi.mocked(createInventoryItem).mockResolvedValue("item-new");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(modal(true));

    await createHilos(user);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "El insumo se guardó, pero no se pudo cargar la lista.",
      ),
    );
    expect(screen.queryByLabelText("Cantidad de Hilos PDO")).toBeNull();
    expect(screen.getByRole("button", { name: "Insumos (0)" })).toBeInTheDocument();
  });

  it("a slow first load cannot overwrite the list reloaded after creating", async () => {
    const firstLoad = deferred<InventoryItem[]>();
    vi.mocked(fetchInventory)
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValueOnce(NEW_LIST);
    vi.mocked(createInventoryItem).mockResolvedValue("item-new");
    const user = userEvent.setup();
    render(modal(true));

    await createHilos(user);
    expect(await screen.findByLabelText("Cantidad de Hilos PDO")).toHaveValue(1);

    // The load started on open answers last, with the old list.
    firstLoad.resolve(OLD_LIST);
    await firstLoad.promise;

    await user.click(screen.getByRole("combobox", { name: "Insumos que usa" }));
    expect(await screen.findByRole("option", { name: /Hilos PDO/ })).toBeInTheDocument();
  });

  it("without an id from the insert, finds the new item by name and unit", async () => {
    vi.mocked(fetchInventory)
      .mockResolvedValueOnce(OLD_LIST)
      .mockResolvedValueOnce(NEW_LIST);
    vi.mocked(createInventoryItem).mockResolvedValue(null);
    const user = userEvent.setup();
    render(modal(true));

    await createHilos(user);

    expect(await screen.findByLabelText("Cantidad de Hilos PDO")).toHaveValue(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("without an id and no single match, asks the user to pick it", async () => {
    // Two active items share the name and unit: guessing could pick the wrong one.
    const twin = { ...NEW_ITEM, id: "item-twin" };
    vi.mocked(fetchInventory)
      .mockResolvedValueOnce(OLD_LIST)
      .mockResolvedValueOnce([...NEW_LIST, twin]);
    vi.mocked(createInventoryItem).mockResolvedValue(null);
    const user = userEvent.setup();
    render(modal(true));

    await createHilos(user);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Insumo creado; selecciónalo en la lista"),
    );
    expect(screen.queryByLabelText("Cantidad de Hilos PDO")).toBeNull();
  });

  it("adds nothing if the service form was closed before the reload finished", async () => {
    const reload = deferred<InventoryItem[]>();
    vi.mocked(fetchInventory)
      .mockResolvedValueOnce(OLD_LIST)
      .mockReturnValueOnce(reload.promise)
      .mockResolvedValue(OLD_LIST);
    vi.mocked(createInventoryItem).mockResolvedValue("item-new");
    const user = userEvent.setup();
    const view = render(modal(true));

    await createHilos(user);
    await waitFor(() => expect(fetchInventory).toHaveBeenCalledTimes(2));

    // Closed and opened again: a new session of the form.
    view.rerender(modal(false));
    view.rerender(modal(true));
    reload.resolve(NEW_LIST);
    await reload.promise;

    expect(
      await screen.findByRole("button", { name: "Insumos (0)" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Cantidad de Hilos PDO")).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });
});
