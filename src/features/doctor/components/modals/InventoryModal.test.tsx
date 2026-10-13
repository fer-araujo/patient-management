import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import type { InventoryItem } from "../../../../lib/services/inventoryService";
import { InventoryModal } from "./InventoryModal";

/** inventory: the used categories on read, the new id on insert. */
const stubInventory = (used: string[]) =>
  supabaseMock.onFrom("inventory", (q) => {
    if (q.has("insert")) return { data: { id: "item-new" } };
    if (q.has("update")) return { data: null };
    const [from] = q.args("range") as [number, number];
    return {
      data: from === 0 ? used.map((category, i) => ({ id: `i${i}`, category })) : [],
    };
  });

const renderModal = (itemToEdit?: InventoryItem) => {
  const onSaved = vi.fn();
  render(
    <InventoryModal
      isOpen={true}
      onClose={() => {}}
      onSaved={onSaved}
      itemToEdit={itemToEdit}
    />,
  );
  return { user: userEvent.setup(), onSaved };
};

const openCategories = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("combobox", { name: "Categoría" }));
  return within(screen.getByRole("listbox", { name: "Categoría" }));
};

const insertedRow = () =>
  supabaseMock.queries("inventory").find((q) => q.has("insert"))?.args("insert")?.[0];

describe("InventoryModal categories", () => {
  it("offers the defaults, the categories already used and + Nueva categoría", async () => {
    stubInventory(["Anestesia", "Desechables"]);
    const { user } = renderModal();

    const list = await openCategories(user);
    await list.findByRole("option", { name: "Anestesia" });

    expect(
      list.getAllByRole("option").map((o) => o.textContent?.trim()),
    ).toEqual([
      "Desechables Clínicos",
      "Medicación / Toxinas",
      "Insumos Quirúrgicos",
      "Productos de Venta",
      "Otro",
      "Anestesia",
      "+ Nueva categoría",
    ]);
  });

  it("saves an item with a category already used", async () => {
    stubInventory(["Anestesia"]);
    const { user, onSaved } = renderModal();

    await user.type(screen.getByLabelText("Nombre del Artículo"), "Lidocaína");
    const list = await openCategories(user);
    await user.click(await list.findByRole("option", { name: "Anestesia" }));
    await user.click(screen.getByRole("button", { name: /Crear Artículo/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(insertedRow()).toMatchObject({ name: "Lidocaína", category: "Anestesia" });
  });

  it("+ Nueva categoría reveals a field and saves the trimmed name", async () => {
    stubInventory([]);
    const { user, onSaved } = renderModal();

    await user.type(screen.getByLabelText("Nombre del Artículo"), "Apósitos");
    const list = await openCategories(user);
    await user.click(list.getByRole("option", { name: "+ Nueva categoría" }));
    expect(screen.getByRole("combobox", { name: "Categoría" })).toHaveTextContent(
      "+ Nueva categoría",
    );
    await user.type(screen.getByLabelText("Nueva categoría"), "  Material de curación ");
    await user.click(screen.getByRole("button", { name: /Crear Artículo/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(insertedRow()).toMatchObject({ category: "Material de curación" });
  });

  it("reuses an existing category typed in another case instead of duplicating it", async () => {
    stubInventory(["Anestesia"]);
    const { user, onSaved } = renderModal();

    await user.type(screen.getByLabelText("Nombre del Artículo"), "Lidocaína");
    const list = await openCategories(user);
    await list.findByRole("option", { name: "Anestesia" });
    await user.click(list.getByRole("option", { name: "+ Nueva categoría" }));
    await user.type(screen.getByLabelText("Nueva categoría"), "ANESTESIA");
    await user.click(screen.getByRole("button", { name: /Crear Artículo/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(insertedRow()).toMatchObject({ category: "Anestesia" });
  });

  it("refuses a new category shorter than 2 characters with a Spanish message", async () => {
    stubInventory([]);
    const { user, onSaved } = renderModal();

    await user.type(screen.getByLabelText("Nombre del Artículo"), "Apósitos");
    const list = await openCategories(user);
    await user.click(list.getByRole("option", { name: "+ Nueva categoría" }));
    await user.type(screen.getByLabelText("Nueva categoría"), " a ");
    await user.click(screen.getByRole("button", { name: /Crear Artículo/ }));

    expect(
      await screen.findByText("La categoría debe tener de 2 a 40 caracteres."),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(insertedRow()).toBeUndefined();
  });

  it("shows the custom category of the item being edited", async () => {
    stubInventory([]);
    renderModal({
      id: "item-1",
      name: "Lidocaína",
      category: "Anestesia",
      stock_quantity: 3,
      min_alert_level: 1,
      unit_measure: "viales",
      last_restock_date: "2026-09-01",
      is_active: true,
    });

    expect(screen.getByRole("combobox", { name: "Categoría" })).toHaveTextContent(
      "Anestesia",
    );
  });
});
