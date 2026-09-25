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

const renderTab = async () => {
  supabaseMock.onFrom("payments", { data: PAYMENTS });
  supabaseMock.onFrom("inventory_movements", { data: PURCHASES });
  render(<FinanceTab />);
  await screen.findByText("Ingresos");
  return { user: userEvent.setup() };
};

const cardValue = (label: string) => screen.getByText(label).nextElementSibling!;

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
    const before = supabaseMock.queries("payments").length;

    await user.click(screen.getByText("Este mes"));
    await user.click(screen.getAllByText("Este año").at(-1)!);

    await waitFor(() =>
      expect(screen.getByTestId("finance-chart").textContent?.split(",")).toHaveLength(12),
    );
    const yearQuery = supabaseMock.queries("payments")[before];
    expect(yearQuery.args("gte")).toEqual(["created_at", "2026-01-01T06:00:00.000Z"]);
    expect(yearQuery.args("lt")).toEqual(["created_at", "2027-01-01T06:00:00.000Z"]);
    // One range covers both the cards and the chart.
    expect(supabaseMock.queries("payments")).toHaveLength(before + 1);
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

  it("lists payments, courtesies and purchases with signed amounts", async () => {
    await renderTab();

    const rowOf = (text: string) => screen.getByText(text).closest("tr")!;
    expect(within(rowOf("Toxina · Ana Pérez")).getByText("Cobro")).toBeInTheDocument();
    expect(within(rowOf("Toxina · Ana Pérez")).getByText(`+${formatMXN(800)}`)).toBeInTheDocument();
    expect(within(rowOf("Valoración · Eva Ruiz")).getByText("Cortesía")).toBeInTheDocument();
    expect(within(rowOf("Jeringas (10)")).getByText("Compra")).toBeInTheDocument();
    expect(within(rowOf("Jeringas (10)")).getByText(formatMXN(-1200))).toHaveClass("text-rose-600");
  });
});
