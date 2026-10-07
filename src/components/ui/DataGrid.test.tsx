import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataGrid, type ColumnDef } from "./DataGrid";
import { mockPhoneViewport } from "../../test/viewport";

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [{ id: "1", name: "Ana" }];

const columns = (stickyActions: boolean): ColumnDef<Row>[] => [
  { header: "Nombre", accessorKey: "name" },
  {
    header: "Acciones",
    stickyRight: stickyActions,
    cell: () => (
      <button type="button" aria-label="Editar">
        E
      </button>
    ),
  },
];

describe("DataGrid", () => {
  it("pins a stickyRight column (header and cells) to the right edge below xl", () => {
    render(
      <DataGrid data={rows} columns={columns(true)} keyExtractor={(r) => r.id} />,
    );

    const header = screen.getByRole("columnheader", { name: "Acciones" });
    const cell = screen.getByRole("button", { name: "Editar" }).closest("td")!;
    for (const el of [header, cell]) {
      expect(el).toHaveClass("max-xl:sticky", "max-xl:right-0", "max-xl:bg-white");
    }
    expect(
      screen.getByRole("columnheader", { name: "Nombre" }),
    ).not.toHaveClass("max-xl:sticky");
  });

  it("leaves columns unpinned unless asked", () => {
    render(
      <DataGrid data={rows} columns={columns(false)} keyExtractor={(r) => r.id} />,
    );
    expect(
      screen.getByRole("columnheader", { name: "Acciones" }),
    ).not.toHaveClass("max-xl:sticky");
  });

  it("does not hint horizontal scroll when the table fits", () => {
    // jsdom lays nothing out: scrollWidth equals clientWidth (0).
    render(
      <DataGrid data={rows} columns={columns(false)} keyExtractor={(r) => r.id} />,
    );
    expect(screen.getByTestId("data-grid-scroller")).not.toHaveAttribute(
      "data-can-scroll-right",
    );
  });
});

interface Appointment {
  id: string;
  patient: string;
  phone: string;
  status: string;
  notes: string;
  visits: number;
}

const appointments: Appointment[] = [
  { id: "a", patient: "Beatriz", phone: "81 1111 1111", status: "Confirmada", notes: "Control", visits: 3 },
  { id: "b", patient: "Ana", phone: "81 2222 2222", status: "Pendiente", notes: "Primera vez", visits: 1 },
  { id: "c", patient: "Carla", phone: "81 3333 3333", status: "Cancelada", notes: "Seguimiento", visits: 7 },
];

const appointmentColumns: ColumnDef<Appointment>[] = [
  { header: "Paciente", accessorKey: "patient", sortable: true, mobileRole: "title" },
  { header: "Teléfono", accessorKey: "phone", mobileRole: "subtitle" },
  { header: "Visitas", accessorKey: "visits", sortable: true },
  { header: "Notas internas", accessorKey: "notes", mobileRole: "hidden" },
  {
    header: "Estado",
    accessorKey: "status",
    mobileRole: "status",
    cell: (row) => <span data-testid="pill">{row.status}</span>,
  },
  {
    header: "Acciones",
    stickyRight: true,
    cell: (row) => (
      <div className="flex justify-end gap-2">
        <button type="button" aria-label={`Editar ${row.patient}`}>
          E
        </button>
      </div>
    ),
  },
];

const cardTitles = () =>
  screen
    .getAllByTestId("data-grid-card")
    .map((card) => card.querySelector(".text-base.font-bold")?.textContent);

describe("DataGrid on a phone (below 768 px)", () => {
  it("keeps the table on iPad and desktop", () => {
    render(
      <DataGrid data={appointments} columns={appointmentColumns} keyExtractor={(r) => r.id} />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("data-grid-cards")).not.toBeInTheDocument();
  });

  it("renders each row as a card laid out by the columns' mobile roles", () => {
    mockPhoneViewport();
    render(
      <DataGrid data={appointments} columns={appointmentColumns} keyExtractor={(r) => r.id} />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const cards = screen.getAllByTestId("data-grid-card");
    expect(cards).toHaveLength(3);

    const card = within(cards[0]);
    expect(card.getByText("Beatriz")).toHaveClass("text-base", "font-bold");
    expect(card.getByText("81 1111 1111")).toHaveClass("text-sm");
    expect(card.getByTestId("pill")).toHaveTextContent("Confirmada");
    // A column without a role is a labelled meta line.
    expect(card.getByText("Visitas").tagName).toBe("DT");
    expect(card.getByText("3").tagName).toBe("DD");
    // Hidden columns are left out.
    expect(card.queryByText("Control")).not.toBeInTheDocument();
    // The sticky column becomes the card's actions, wrapping from the left.
    const actions = card.getByTestId("data-grid-card-actions");
    expect(within(actions).getByRole("button", { name: "Editar Beatriz" })).toBeInTheDocument();
    expect(actions).toHaveClass("[&_button]:grow", "[&>div>*]:flex-wrap");
  });

  it("sorts with the 'Ordenar por' list and the direction button", async () => {
    mockPhoneViewport();
    const user = userEvent.setup();
    render(
      <DataGrid data={appointments} columns={appointmentColumns} keyExtractor={(r) => r.id} />,
    );
    expect(cardTitles()).toEqual(["Beatriz", "Ana", "Carla"]);

    const direction = screen.getByRole("button", { name: /Orden ascendente/ });
    expect(direction).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "Ordenar por" }));
    await user.click(screen.getByRole("option", { name: "Paciente" }));
    expect(cardTitles()).toEqual(["Ana", "Beatriz", "Carla"]);

    await user.click(direction);
    expect(cardTitles()).toEqual(["Carla", "Beatriz", "Ana"]);
    expect(screen.getByRole("button", { name: /Orden descendente/ })).toBeEnabled();

    await user.click(screen.getByRole("combobox", { name: "Ordenar por" }));
    await user.click(screen.getByRole("option", { name: "Orden original" }));
    expect(cardTitles()).toEqual(["Beatriz", "Ana", "Carla"]);
  });

  it("paginates the cards", async () => {
    mockPhoneViewport();
    const user = userEvent.setup();
    render(
      <DataGrid
        data={appointments}
        columns={appointmentColumns}
        keyExtractor={(r) => r.id}
        itemsPerPage={2}
      />,
    );
    expect(cardTitles()).toEqual(["Beatriz", "Ana"]);
    await user.click(screen.getByRole("button", { name: "Página 2" }));
    expect(cardTitles()).toEqual(["Carla"]);
  });

  it("falls back to title + meta lines + actions without mobile roles", () => {
    mockPhoneViewport();
    render(<DataGrid data={rows} columns={columns(true)} keyExtractor={(r) => r.id} />);
    const card = within(screen.getByTestId("data-grid-card"));
    expect(card.getByText("Ana")).toHaveClass("text-base", "font-bold");
    expect(
      within(card.getByTestId("data-grid-card-actions")).getByRole("button", { name: "Editar" }),
    ).toBeInTheDocument();
    // Nothing sortable: no sort bar.
    expect(screen.queryByText("Ordenar por")).not.toBeInTheDocument();
  });

  it("shows the empty state", () => {
    mockPhoneViewport();
    render(
      <DataGrid
        data={[] as Row[]}
        columns={columns(true)}
        keyExtractor={(r) => r.id}
        emptyState={<p>Sin citas</p>}
      />,
    );
    expect(screen.getByText("Sin citas")).toBeInTheDocument();
    expect(screen.queryByTestId("data-grid-card")).not.toBeInTheDocument();
  });
});
