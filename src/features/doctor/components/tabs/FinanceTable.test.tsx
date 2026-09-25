import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatMXN } from "../../../../lib/services/inventoryService";
import { FinanceTable } from "./FinanceTable";

const rowOf = (label: string) => screen.getByText(label).closest("tr")!;
const cells = (label: string) =>
  within(rowOf(label))
    .getAllByRole("cell")
    .map((c) => c.textContent);

describe("FinanceTable", () => {
  const data = [
    { month: "2026-08", income: 1000, courtesy: 500, expenses: 300 },
    { month: "2026-09", income: 200.5, courtesy: 0, expenses: 700 },
  ];

  it("shows one row per month with Mes | Ingresos | Cortesías | Gastos | Ganancia", () => {
    render(<FinanceTable data={data} />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Mes", "Ingresos", "Cortesías", "Gastos", "Ganancia",
    ]);
    expect(cells("Agosto de 2026")).toEqual([
      "Agosto de 2026", formatMXN(1000), formatMXN(500), formatMXN(300), formatMXN(700),
    ]);
  });

  it("never subtracts courtesies from the profit", () => {
    render(<FinanceTable data={data} />);
    // 1000 - 300 = 700, not 1000 - 300 - 500.
    expect(cells("Agosto de 2026")[4]).toBe(formatMXN(700));
  });

  it("adds a bold Total row and marks a negative profit in rose", () => {
    render(<FinanceTable data={data} />);

    expect(cells("Total")).toEqual([
      "Total", formatMXN(1200.5), formatMXN(500), formatMXN(1000), formatMXN(200.5),
    ]);
    expect(screen.getByText("Total")).toHaveClass("font-black");

    const loss = within(rowOf("Septiembre de 2026")).getByText(formatMXN(-499.5));
    expect(loss).toHaveClass("text-rose-600");
    expect(within(rowOf("Total")).getByText(formatMXN(200.5))).not.toHaveClass("text-rose-600");
  });
});
