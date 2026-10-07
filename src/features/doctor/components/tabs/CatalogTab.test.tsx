import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { supabaseMock, type RecordedQuery } from "../../../../test/supabaseMock";
import { CatalogTab } from "./CatalogTab";

const serviceRow = (overrides: Record<string, unknown> = {}) => ({
  id: "svc-relleno",
  name: "Relleno",
  category: "Armonización",
  description: "Ácido hialurónico",
  duration_mins: 45,
  price: 4500,
  care_guide: "",
  is_active: true,
  service_supplies: [
    { item_id: "item-j", quantity: 2, inventory: { name: "Jeringas", unit_measure: "piezas" } },
    { item_id: "item-s", quantity: 1, inventory: { name: "Sculptra", unit_measure: "viales" } },
  ],
  ...overrides,
});

const SERVICES = [
  serviceRow(),
  serviceRow({ id: "svc-valoracion", name: "Valoración", service_supplies: [] }),
];

const inventoryRow = (id: string, name: string, unit: string, isActive = true) => ({
  id,
  name,
  category: "Insumos",
  stock_quantity: 20,
  min_alert_level: 1,
  unit_measure: unit,
  last_restock_date: "2026-09-01",
  is_active: isActive,
});

const INVENTORY = [
  inventoryRow("item-s", "Sculptra", "viales"),
  inventoryRow("item-j", "Jeringas", "piezas"),
  inventoryRow("item-g", "Gasas", "paquetes"),
  inventoryRow("item-old", "Aguja vieja", "piezas", false),
];

/** Lists answer with the catalog; an insert answers with the new id. */
const servicesResponder = (query: RecordedQuery) =>
  query.has("insert")
    ? { data: { id: "svc-new" } }
    : query.has("update")
      ? { data: null }
      : { data: SERVICES };

const renderTab = async () => {
  supabaseMock.onFrom("services", servicesResponder);
  supabaseMock.onFrom("inventory", { data: INVENTORY });
  render(<CatalogTab />);
  await screen.findByText("Relleno");
  return { user: userEvent.setup() };
};

const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
const quantityOf = (name: string) => screen.getByLabelText(`Cantidad de ${name}`);

type User = ReturnType<typeof userEvent.setup>;

/** Picking an item adds its row right away; the quantity is set in the row. */
const pickSupply = async (user: User, name: string) => {
  await user.click(screen.getByRole("combobox", { name: "Insumos que usa" }));
  await user.click(screen.getByRole("option", { name }));
};

/** The service modal shows one section at a time: "Datos" or "Insumos (N)". */
const openSuppliesSection = async (user: User) =>
  user.click(await screen.findByRole("button", { name: /^Insumos \(\d+\)$/ }));

const openEdit = async (user: User, name: string) => {
  await user.click(within(rowOf(name)).getByTitle("Editar Tratamiento"));
  await openSuppliesSection(user);
};

/** Names of the supply rows, in the order they are shown. */
const listedSupplies = () =>
  screen.getAllByLabelText(/^Cantidad de /).map((input) =>
    input.getAttribute("aria-label")!.replace("Cantidad de ", ""),
  );

describe("CatalogTab supplies", () => {
  it('shows the supplies of each service in an "Insumos" column', async () => {
    await renderTab();

    expect(screen.getByRole("columnheader", { name: "Insumos" })).toBeInTheDocument();
    expect(within(rowOf("Relleno")).getByText("Jeringas, Sculptra")).toBeInTheDocument();
    expect(within(rowOf("Valoración")).getByText("—")).toBeInTheDocument();
    expect(String(supabaseMock.queries("services")[0].args("select")?.[0])).toContain(
      "service_supplies ( item_id, quantity, inventory ( name, unit_measure ) )",
    );
  });

  it('keeps a long list short ("+N más") and shows all of it, with quantities, on tap', async () => {
    const supply = (id: string, name: string, quantity = 1) => ({
      item_id: id,
      quantity,
      inventory: { name, unit_measure: "piezas" },
    });
    supabaseMock.onFrom("services", {
      data: [
        serviceRow({
          service_supplies: [
            supply("a", "Sculptra", 2),
            supply("b", "Jeringas"),
            supply("c", "Gasas"),
            supply("d", "Agujas"),
          ],
        }),
      ],
    });
    supabaseMock.onFrom("inventory", { data: INVENTORY });
    render(<CatalogTab />);
    await screen.findByText("Relleno");
    const user = userEvent.setup();

    const cell = within(rowOf("Relleno")).getByRole("button", { name: "Ver insumos de Relleno" });
    // Supplies come sorted by name.
    expect(cell).toHaveTextContent("Agujas, Gasas +2 más");
    // Desktop keeps the old plain-text look: the 44 px touch height applies
    // only under the touch/phone variants (jsdom applies no Tailwind CSS).
    const classes = cell.className.split(/\s+/);
    expect(classes).not.toContain("min-h-11");
    expect(classes).toEqual(
      expect.arrayContaining(["pointer-coarse:min-h-11", "max-md:min-h-11"]),
    );

    await user.click(cell);
    const dialog = (await screen.findByRole("heading", { name: "Insumos de Relleno" })).closest(
      "div.relative",
    )! as HTMLElement;
    for (const name of ["Sculptra", "Jeringas", "Gasas", "Agujas"]) {
      expect(within(dialog).getByText(name)).toBeInTheDocument();
    }
    expect(within(dialog).getByText("2 piezas")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Insumos de Relleno")).toBeNull());
  });

  it("edits the supplies of a service and saves them with it", async () => {
    const { user } = await renderTab();

    await openEdit(user, "Relleno");
    expect(quantityOf("Jeringas")).toHaveValue(2);
    expect(quantityOf("Sculptra")).toHaveValue(1);

    // Change a quantity, remove one and add another.
    await user.clear(quantityOf("Jeringas"));
    await user.type(quantityOf("Jeringas"), "3");
    await user.click(screen.getByRole("button", { name: "Quitar Sculptra" }));
    await pickSupply(user, "Gasas");
    expect(quantityOf("Gasas")).toHaveValue(1);
    await user.clear(quantityOf("Gasas"));
    await user.type(quantityOf("Gasas"), "2");

    expect(quantityOf("Gasas")).toHaveValue(2);
    expect(screen.queryByLabelText("Cantidad de Sculptra")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(supabaseMock.rpcCalls("set_service_supplies")).toHaveLength(1));
    expect(supabaseMock.lastRpc("set_service_supplies")?.args).toEqual({
      p_service_id: "svc-relleno",
      p_supplies: [
        { item_id: "item-j", quantity: 3 },
        { item_id: "item-g", quantity: 2 },
      ],
    });
    const update = supabaseMock.queries("services").find((q) => q.has("update"))!;
    expect(update.args("eq")).toEqual(["id", "svc-relleno"]);
  });

  it("shows one section at a time, with a live count of the supplies", async () => {
    const { user } = await renderTab();
    await user.click(within(rowOf("Relleno")).getByTitle("Editar Tratamiento"));

    expect(await screen.findByLabelText("Nombre del Servicio")).toBeVisible();
    expect(screen.getByRole("button", { name: "Datos del servicio" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Cantidad de Jeringas")).toBeNull();

    await openSuppliesSection(user);
    expect(screen.getByLabelText("Nombre del Servicio")).not.toBeVisible();
    await pickSupply(user, "Gasas");

    expect(screen.getByRole("button", { name: "Insumos (3)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("starts empty, then lists the supplies alphabetically with the last one added on top", async () => {
    const { user } = await renderTab();
    await openEdit(user, "Valoración");
    expect(screen.getByText("Este servicio no usa insumos")).toBeInTheDocument();

    await pickSupply(user, "Sculptra");
    await pickSupply(user, "Gasas");
    await pickSupply(user, "Jeringas");

    expect(listedSupplies()).toEqual(["Jeringas", "Gasas", "Sculptra"]);
    expect(screen.queryByText("Este servicio no usa insumos")).toBeNull();
  });

  it("the stepper raises and lowers a quantity, never below 1", async () => {
    const { user } = await renderTab();
    await openEdit(user, "Relleno");

    await user.click(screen.getByRole("button", { name: "Más Jeringas" }));
    expect(quantityOf("Jeringas")).toHaveValue(3);
    await user.click(screen.getByRole("button", { name: "Menos Jeringas" }));
    expect(quantityOf("Jeringas")).toHaveValue(2);

    expect(quantityOf("Sculptra")).toHaveValue(1);
    expect(screen.getByRole("button", { name: "Menos Sculptra" })).toBeDisabled();
  });

  it("offers only active items, marking the listed ones, and a pick adds a row of 1 with its unit", async () => {
    const { user } = await renderTab();
    await openEdit(user, "Relleno");

    await user.click(screen.getByRole("combobox", { name: "Insumos que usa" }));
    const options = within(screen.getByRole("listbox", { name: "Insumos que usa" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "Sculptra (ya en la lista)",
      "Jeringas (ya en la lista)",
      "Gasas",
    ]);

    await user.click(screen.getByRole("option", { name: "Gasas" }));
    expect(quantityOf("Gasas")).toHaveValue(1);
    expect(screen.getByText("paquetes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agregar/ })).toBeNull();
    // Every active item is listed now, so the picker gives way to a note.
    expect(screen.getByText("No hay más artículos activos en el inventario.")).toBeInTheDocument();
  });

  it("picking an item that is already listed focuses its quantity instead of adding it twice", async () => {
    const { user } = await renderTab();
    await openEdit(user, "Relleno");

    await pickSupply(user, "Jeringas (ya en la lista)");

    expect(screen.getAllByLabelText("Cantidad de Jeringas")).toHaveLength(1);
    expect(quantityOf("Jeringas")).toHaveValue(2);
    expect(quantityOf("Jeringas")).toHaveFocus();

    // Typing now replaces the selected quantity.
    await user.keyboard("5");
    expect(quantityOf("Jeringas")).toHaveValue(5);
  });

  it("does not save while a quantity is empty or 0", async () => {
    const { user } = await renderTab();
    await openEdit(user, "Relleno");

    await user.clear(quantityOf("Jeringas"));
    await user.type(quantityOf("Jeringas"), "0");

    expect(screen.getByText("Escribe una cantidad de 1 o más, o quítalo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar Cambios/ })).toBeDisabled();
    // From "Datos" the reason is still named.
    await user.click(screen.getByRole("button", { name: "Datos del servicio" }));
    expect(screen.getByText("Revisa las cantidades en Insumos.")).toBeInTheDocument();
    expect(supabaseMock.rpcCalls("set_service_supplies")).toHaveLength(0);
  });

  it("saving from Insumos with an empty name goes back to Datos and focuses the name", async () => {
    const { user } = await renderTab();
    await user.click(screen.getByRole("button", { name: /Añadir Tratamiento/ }));
    await openSuppliesSection(user);

    await user.click(screen.getByRole("button", { name: /Crear Servicio/ }));

    expect(screen.getByLabelText("Nombre del Servicio")).toBeVisible();
    expect(screen.getByLabelText("Nombre del Servicio")).toHaveFocus();
    expect(supabaseMock.queries("services").some((q) => q.has("insert"))).toBe(false);
  });

  it("a new service is created first, then its supplies are saved under its id", async () => {
    const { user } = await renderTab();

    await user.click(screen.getByRole("button", { name: /Añadir Tratamiento/ }));
    await user.type(await screen.findByLabelText("Nombre del Servicio"), "Bioestimulador");
    await openSuppliesSection(user);
    await pickSupply(user, "Sculptra");
    await user.click(screen.getByRole("button", { name: /Crear Servicio/ }));

    await waitFor(() => expect(supabaseMock.rpcCalls("set_service_supplies")).toHaveLength(1));
    const insert = supabaseMock.queries("services").find((q) => q.has("insert"))!;
    expect(insert.args("insert")?.[0]).toMatchObject({ name: "Bioestimulador" });
    expect(supabaseMock.lastRpc("set_service_supplies")?.args).toEqual({
      p_service_id: "svc-new",
      p_supplies: [{ item_id: "item-s", quantity: 1 }],
    });
  });

  it("shows the server's reason when the supplies cannot be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const toastError = vi.spyOn(toast, "error");
    supabaseMock.onRpc("set_service_supplies", {
      error: { code: "P0001", message: "Uno de los insumos ya no existe en el inventario." },
    });
    const { user } = await renderTab();
    await openEdit(user, "Relleno");

    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // The modal stays open so the doctor can fix the list.
    expect(screen.getByLabelText("Cantidad de Jeringas")).toBeInTheDocument();
  });
});

describe("CatalogTab new supply from the service form", () => {
  const NEW_ROW = inventoryRow("item-new", "Hilos PDO", "piezas");

  /** Opens "Nuevo insumo" over a new service whose name is already typed. */
  const openNewSupply = async () => {
    let created = false;
    supabaseMock.onFrom("services", servicesResponder);
    supabaseMock.onFrom("inventory", (query) => {
      if (query.has("insert")) {
        created = true;
        return { data: { id: "item-new" } };
      }
      return { data: created ? [...INVENTORY, NEW_ROW] : INVENTORY };
    });
    render(<CatalogTab />);
    await screen.findByText("Relleno");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Añadir Tratamiento/ }));
    await user.type(await screen.findByLabelText("Nombre del Servicio"), "Bioestimulador");
    await openSuppliesSection(user);
    await user.click(screen.getByRole("button", { name: /Nuevo insumo/ }));
    expect(await screen.findByText("Añadir al Inventario")).toBeInTheDocument();
    return { user };
  };

  /** The service modal's own buttons come first; the stacked form is last. */
  const lastButton = (name: string) => screen.getAllByRole("button", { name }).at(-1)!;

  it("creates the item over the service form and adds it with 1, keeping what was typed", async () => {
    const { user } = await openNewSupply();

    await user.type(screen.getByLabelText("Nombre del Artículo"), "Hilos PDO");
    await user.click(screen.getByRole("button", { name: /Crear Artículo/ }));

    expect(await screen.findByLabelText("Cantidad de Hilos PDO")).toHaveValue(1);
    await waitFor(() => expect(screen.queryByText("Añadir al Inventario")).toBeNull());
    const insert = supabaseMock.queries("inventory").find((q) => q.has("insert"))!;
    expect(insert.args("insert")?.[0]).toMatchObject({ name: "Hilos PDO", is_active: true });
    // Saving the item did not submit the service form underneath.
    expect(supabaseMock.queries("services").some((q) => q.has("insert"))).toBe(false);
    expect(screen.getByRole("button", { name: "Insumos (1)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Datos del servicio" }));
    expect(screen.getByLabelText("Nombre del Servicio")).toHaveValue("Bioestimulador");

    await user.click(screen.getByRole("button", { name: /Crear Servicio/ }));
    await waitFor(() => expect(supabaseMock.rpcCalls("set_service_supplies")).toHaveLength(1));
    expect(supabaseMock.lastRpc("set_service_supplies")?.args).toEqual({
      p_service_id: "svc-new",
      p_supplies: [{ item_id: "item-new", quantity: 1 }],
    });
  });

  it("cancel or close shuts only the new-item form and keeps the service form as it was", async () => {
    const { user } = await openNewSupply();
    await user.type(screen.getByLabelText("Nombre del Artículo"), "Hilos PDO");

    await user.click(lastButton("Cancelar"));
    await waitFor(() => expect(screen.queryByText("Añadir al Inventario")).toBeNull());
    expect(screen.getByText("Este servicio no usa insumos")).toBeInTheDocument();

    // The top modal's close button closes that one only, too.
    await user.click(screen.getByRole("button", { name: /Nuevo insumo/ }));
    await screen.findByText("Añadir al Inventario");
    await user.click(lastButton("Cerrar ventana"));
    await waitFor(() => expect(screen.queryByText("Añadir al Inventario")).toBeNull());

    // And so does Escape: the service form stays open underneath.
    await user.click(screen.getByRole("button", { name: /Nuevo insumo/ }));
    await screen.findByText("Añadir al Inventario");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Añadir al Inventario")).toBeNull());
    expect(screen.getByText("Añadir Tratamiento", { selector: "h3" })).toBeInTheDocument();

    expect(supabaseMock.queries("inventory").some((q) => q.has("insert"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Datos del servicio" }));
    expect(screen.getByLabelText("Nombre del Servicio")).toHaveValue("Bioestimulador");
  });
});
