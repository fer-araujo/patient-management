import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabaseMock } from "../../../../test/supabaseMock";
import { formatMXN } from "../../../../lib/services/inventoryService";
import type { MonthlyFinance } from "../../../../lib/services/financeService";
import { FinanceTab } from "./FinanceTab";

// Recharts needs real layout; the chart has its own test. Here it only
// reports which months it was given.
vi.mock("./FinanceChart", () => ({
  FinanceChart: ({ data }: { data: MonthlyFinance[] }) => (
    <div data-testid="finance-chart">{data.map((d) => d.month).join(",")}</div>
  ),
}));

const PAYMENTS = [
  {
    id: "p1", status: "paid", amount_charged: "800.00", list_price: "800.00",
    created_at: "2026-09-10T16:00:00+00:00",
    services: { name: "Toxina" }, patients: { first_name: "Ana", last_name: "Pérez" },
  },
  {
    id: "p2", status: "courtesy", amount_charged: "0.00", list_price: "900.00",
    created_at: "2026-09-13T16:00:00+00:00",
    services: { name: "Valoración" }, patients: { first_name: "Eva", last_name: "Ruiz" },
  },
];
const PURCHASES = [
  {
    id: "m1", quantity: 10, total_cost: "1200.00",
    created_at: "2026-09-11T16:00:00+00:00", inventory: { name: "Jeringas" },
  },
];

const PROCEDURES = [
  {
    service_id: "svc-toxina", service_name: "Toxina", times: 1,
    charged: "800.00", courtesy_value: "0.00", supplies_cost: "300.00",
    uncosted_supplies: 0, profit: "500.00",
  },
  {
    service_id: "svc-valoracion", service_name: "Valoración", times: 1,
    charged: "0.00", courtesy_value: "900.00", supplies_cost: "120.00",
    uncosted_supplies: 1, profit: "-120.00",
  },
];

const renderTab = async (props: { showPatientNames?: boolean } = {}) => {
  supabaseMock.onFrom("payments", { data: PAYMENTS });
  supabaseMock.onFrom("inventory_movements", { data: PURCHASES });
  render(<FinanceTab {...props} />);
  await screen.findByText("Ingresos");
  return { user: userEvent.setup() };
};

// Card labels are <p>; the same words also head table columns.
const cardValue = (label: string) =>
  screen.getByText(label, { selector: "p" }).nextElementSibling!;

beforeEach(() => {
  // Only Date is faked, so userEvent and the promises keep working.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-25T12:00:00-06:00"));
});

describe("FinanceTab", () => {
  it("shows income, expenses, a negative profit in rose, and the courtesies", async () => {
    await renderTab();

    expect(cardValue("Ingresos")).toHaveTextContent(formatMXN(800));
    expect(cardValue("Gastos")).toHaveTextContent(formatMXN(1200));
    expect(cardValue("Ganancia")).toHaveTextContent(formatMXN(-400));
    expect(cardValue("Ganancia")).toHaveClass("text-rose-600");
    expect(cardValue("Cortesías")).toHaveTextContent("1");
    expect(screen.getByText(`Valor no cobrado: ${formatMXN(900)}`)).toBeInTheDocument();
  });

  it("starts on this month, charting the year so far", async () => {
    await renderTab();

    const periodQuery = supabaseMock.queries("payments")[0];
    expect(periodQuery.args("gte")).toEqual(["created_at", "2026-09-01T06:00:00.000Z"]);
    expect(periodQuery.args("lt")).toEqual(["created_at", "2026-10-01T06:00:00.000Z"]);
    expect(screen.getByTestId("finance-chart")).toHaveTextContent(
      "2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07,2026-08,2026-09",
    );
  });

  it("switching to this year reloads the whole year", async () => {
    const { user } = await renderTab();
    // Each load reads pages until an empty one; count the first pages.
    const firstPages = () =>
      supabaseMock.queries("payments").filter((q) => q.args("range")?.[0] === 0);
    const before = firstPages().length;

    await user.click(screen.getByText("Este mes"));
    await user.click(screen.getAllByText("Este año").at(-1)!);

    await waitFor(() =>
      expect(screen.getByTestId("finance-chart").textContent?.split(",")).toHaveLength(12),
    );
    const yearQuery = firstPages()[before];
    expect(yearQuery.args("gte")).toEqual(["created_at", "2026-01-01T06:00:00.000Z"]);
    expect(yearQuery.args("lt")).toEqual(["created_at", "2027-01-01T06:00:00.000Z"]);
    // One range covers both the cards and the chart.
    expect(firstPages()).toHaveLength(before + 1);
  });

  it("the chart card switches between Gráfica and Tabla", async () => {
    const { user } = await renderTab();

    expect(screen.getByRole("radio", { name: "Gráfica" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("finance-chart")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Tabla" }));

    expect(screen.queryByTestId("finance-chart")).toBeNull();
    expect(screen.getByRole("radio", { name: "Tabla" })).toHaveAttribute("aria-checked", "true");
    // September: 800 charged, 900 given as courtesy, 1200 spent -> profit -400.
    const september = screen.getByText("Septiembre de 2026").closest("tr")!;
    expect(within(september).getByText(formatMXN(900))).toBeInTheDocument();
    expect(within(september).getByText(formatMXN(-400))).toHaveClass("text-rose-600");
    expect(screen.getByText("Total")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Gráfica" }));
    expect(screen.getByTestId("finance-chart")).toBeInTheDocument();
  });

  it("the profit card is income minus expenses; courtesies do not reduce it", async () => {
    await renderTab();
    // 800 - 1200 = -400; the 900 courtesy is reported apart, not subtracted.
    expect(cardValue("Ganancia")).toHaveTextContent(formatMXN(-400));
    expect(cardValue("Ganancia")).not.toHaveTextContent(formatMXN(-1300));
  });

  it("lists payments, courtesies and purchases with signed amounts (doctor view)", async () => {
    await renderTab({ showPatientNames: true });

    const rowOf = (text: string) => screen.getByText(text).closest("tr")!;
    expect(within(rowOf("Toxina · Ana Pérez")).getByText("Cobro")).toBeInTheDocument();
    expect(within(rowOf("Toxina · Ana Pérez")).getByText(`+${formatMXN(800)}`)).toBeInTheDocument();
    expect(within(rowOf("Valoración · Eva Ruiz")).getByText("Cortesía")).toBeInTheDocument();
    expect(within(rowOf("Jeringas (10)")).getByText("Compra")).toBeInTheDocument();
    expect(within(rowOf("Jeringas (10)")).getByText(formatMXN(-1200))).toHaveClass("text-rose-600");
  });

  it("shows an admin the amount and the service but never the patient", async () => {
    await renderTab();

    const rowOf = (text: string) => screen.getByText(text).closest("tr")!;
    expect(within(rowOf("Toxina")).getByText("Cobro")).toBeInTheDocument();
    expect(within(rowOf("Toxina")).getByText(`+${formatMXN(800)}`)).toBeInTheDocument();
    expect(within(rowOf("Valoración")).getByText("Cortesía")).toBeInTheDocument();
    expect(screen.queryByText(/Ana|Pérez|Eva|Ruiz/)).not.toBeInTheDocument();

    const periodQuery = supabaseMock.queries("payments")[0];
    expect(String(periodQuery.args("select")?.[0])).not.toContain("patients");
  });

  describe("Ganancia por procedimiento", () => {
    const profitTable = () =>
      screen.getByText("Ganancia por procedimiento").parentElement!;

    it.each([
      ["an admin", {}],
      ["the doctor", { showPatientNames: true }],
    ])("shows %s one row per service with charged, courtesies, supplies and profit", async (_who, props) => {
      supabaseMock.onRpc("get_procedure_profit", { data: PROCEDURES });
      await renderTab(props);

      const table = within(profitTable());
      const toxina = table.getByText("Toxina").closest("tr")!;
      expect(within(toxina).getByText(formatMXN(800))).toBeInTheDocument();
      expect(within(toxina).getByText(formatMXN(300))).toBeInTheDocument();
      expect(within(toxina).getByText(formatMXN(500))).toBeInTheDocument();

      // Marked because one of its supplies has no registered cost.
      const valoracion = table.getByText("Valoración *").closest("tr")!;
      expect(within(valoracion).getByText(formatMXN(900))).toBeInTheDocument();
      expect(within(valoracion).getByText(formatMXN(-120))).toHaveClass("text-rose-600");

      const total = table.getByText("Total").closest("tr")!;
      expect(within(total).getByText("2")).toBeInTheDocument();
      expect(within(total).getByText(formatMXN(380))).toBeInTheDocument();

      expect(
        table.getByText("Compara lo cobrado contra el costo de los insumos usados en cada procedimiento."),
      ).toBeInTheDocument();
      expect(table.getByText(/Algunos insumos usados no tienen costo registrado/)).toBeInTheDocument();
      // Same range as the cards.
      expect(supabaseMock.lastRpc("get_procedure_profit")?.args).toEqual({
        p_from: "2026-09-01T06:00:00.000Z",
        p_to: "2026-10-01T06:00:00.000Z",
      });
      // No patient ever appears in it.
      expect(table.queryByText(/Ana|Pérez|Eva|Ruiz/)).toBeNull();
    });

    it("keeps the cash view as is: the profit card still ignores the supplies used", async () => {
      supabaseMock.onRpc("get_procedure_profit", { data: PROCEDURES });
      await renderTab();
      // 800 charged - 1200 purchased; the 420 of supplies used is not subtracted again.
      expect(cardValue("Ganancia")).toHaveTextContent(formatMXN(-400));
    });

    it("warns how many consultations have no recorded supplies", async () => {
      supabaseMock.onRpc("get_procedure_profit", {
        data: [
          { ...PROCEDURES[0], unrecorded_consultations: 2 },
          { ...PROCEDURES[1], unrecorded_consultations: 0 },
        ],
      });
      await renderTab();

      expect(
        within(profitTable()).getByText(
          "2 consultas sin insumos registrados: la ganancia puede estar incompleta.",
        ),
      ).toBeInTheDocument();
    });

    it("uses the singular for one, and says nothing when all were recorded", async () => {
      supabaseMock.onRpc("get_procedure_profit", {
        data: [{ ...PROCEDURES[0], unrecorded_consultations: 1 }],
      });
      await renderTab();
      expect(
        screen.getByText("1 consulta sin insumos registrados: la ganancia puede estar incompleta."),
      ).toBeInTheDocument();
    });

    it("says nothing about unrecorded supplies when every consultation has them", async () => {
      supabaseMock.onRpc("get_procedure_profit", { data: PROCEDURES });
      await renderTab();
      expect(screen.queryByText(/sin insumos registrados/)).toBeNull();
    });

    it("has no missing-cost note when every supply had a cost", async () => {
      supabaseMock.onRpc("get_procedure_profit", { data: [PROCEDURES[0]] });
      await renderTab();
      expect(screen.queryByText(/Algunos insumos usados no tienen costo registrado/)).toBeNull();
    });

    it("only this card shows an error when its data fails; the rest still loads", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      supabaseMock.onRpc("get_procedure_profit", { error: { message: "boom", code: "XX000" } });
      await renderTab();

      expect(within(profitTable()).getByText(/No se pudo cargar esta tabla/)).toBeInTheDocument();
      expect(cardValue("Ingresos")).toHaveTextContent(formatMXN(800));
    });
  });
});
