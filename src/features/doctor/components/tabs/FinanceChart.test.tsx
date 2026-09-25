import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinanceChart } from "./FinanceChart";

beforeAll(() => {
  // jsdom has no ResizeObserver; Recharts' ResponsiveContainer needs one.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe("FinanceChart", () => {
  it("names the three series in a legend", () => {
    render(
      <FinanceChart
        data={[{ month: "2026-09", income: 1300, courtesy: 900, expenses: 1600 }]}
      />,
    );

    expect(screen.getByText("Ingresos")).toBeInTheDocument();
    expect(screen.getByText("Cortesías (no cobrado)")).toBeInTheDocument();
    expect(screen.getByText("Gastos")).toBeInTheDocument();
  });

  it("charts a month that only had courtesies", () => {
    render(<FinanceChart data={[{ month: "2026-09", income: 0, courtesy: 900, expenses: 0 }]} />);
    expect(screen.queryByText("No hay ingresos ni gastos en este periodo.")).toBeNull();
  });

  it("says so plainly when there is nothing to chart", () => {
    render(<FinanceChart data={[{ month: "2026-09", income: 0, courtesy: 0, expenses: 0 }]} />);
    expect(screen.getByText("No hay ingresos ni gastos en este periodo.")).toBeInTheDocument();
  });
});
