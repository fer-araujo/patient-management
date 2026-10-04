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

const addSupply = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  quantity: string,
) => {
  await user.click(screen.getByRole("combobox", { name: "Insumos que usa" }));
  await user.click(screen.getByRole("option", { name }));
  await user.clear(screen.getByLabelText("Cantidad a agregar"));
  await user.type(screen.getByLabelText("Cantidad a agregar"), quantity);
  await user.click(screen.getByRole("button", { name: /Agregar/ }));
};

describe("CatalogTab supplies", () => {
  it('shows the supplies of each service in an "Insumos" column', async () => {
    await renderTab();

    expect(screen.getByRole("columnheader", { name: "Insumos" })).toBeInTheDocument();
    expect(within(rowOf("Relleno")).getByText("2 Jeringas · 1 Sculptra")).toBeInTheDocument();
    expect(within(rowOf("Valoración")).getByText("—")).toBeInTheDocument();
    expect(String(supabaseMock.queries("services")[0].args("select")?.[0])).toContain(
      "service_supplies ( item_id, quantity, inventory ( name, unit_measure ) )",
    );
  });

  it("edits the supplies of a service and saves them with it", async () => {
    const { user } = await renderTab();

    await user.click(within(rowOf("Relleno")).getByTitle("Editar Tratamiento"));
    expect(await screen.findByText("Insumos que usa")).toBeInTheDocument();
    expect(quantityOf("Jeringas")).toHaveValue(2);
    expect(quantityOf("Sculptra")).toHaveValue(1);

    // Change a quantity, remove one and add another.
    await user.clear(quantityOf("Jeringas"));
    await user.type(quantityOf("Jeringas"), "3");
    await user.click(screen.getByRole("button", { name: "Quitar Sculptra" }));
    await addSupply(user, "Gasas", "2");

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

  it("offers only active items that are not listed yet, showing the chosen item's unit", async () => {
    const { user } = await renderTab();
    await user.click(within(rowOf("Relleno")).getByTitle("Editar Tratamiento"));
    await screen.findByText("Insumos que usa");

    await user.click(screen.getByRole("combobox", { name: "Insumos que usa" }));
    const options = within(screen.getByRole("listbox", { name: "Insumos que usa" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Gasas"]);

    await user.click(screen.getByRole("option", { name: "Gasas" }));
    expect(screen.getByText("paquetes")).toBeInTheDocument();
  });

  it("does not save while a quantity is empty or 0", async () => {
    const { user } = await renderTab();
    await user.click(within(rowOf("Relleno")).getByTitle("Editar Tratamiento"));
    await screen.findByText("Insumos que usa");

    await user.clear(quantityOf("Jeringas"));
    await user.type(quantityOf("Jeringas"), "0");

    expect(screen.getByText("Escribe una cantidad de 1 o más, o quítalo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar Cambios/ })).toBeDisabled();
    expect(supabaseMock.rpcCalls("set_service_supplies")).toHaveLength(0);
  });

  it("a new service is created first, then its supplies are saved under its id", async () => {
    const { user } = await renderTab();

    await user.click(screen.getByRole("button", { name: /Añadir Tratamiento/ }));
    await user.type(await screen.findByLabelText("Nombre del Servicio"), "Bioestimulador");
    await addSupply(user, "Sculptra", "1");
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
    await user.click(within(rowOf("Relleno")).getByTitle("Editar Tratamiento"));
    await screen.findByText("Insumos que usa");

    await user.click(screen.getByRole("button", { name: /Guardar Cambios/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // The modal stays open so the doctor can fix the list.
    expect(screen.getByText("Insumos que usa")).toBeInTheDocument();
  });
});
