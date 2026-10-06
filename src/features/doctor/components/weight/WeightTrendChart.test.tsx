import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BodyMeasurement } from "../../../../lib/services/bodyMeasurementService";
import { WeightTrendChart } from "./WeightTrendChart";

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

const measurement = (over: Partial<BodyMeasurement>): BodyMeasurement => ({
  id: over.measured_at ?? "m",
  patient_id: "p1",
  measured_at: "2026-09-01",
  appointment_id: null,
  weight_kg: 70,
  height_cm: null,
  bmi: null,
  body_fat_pct: null,
  body_fat_kg: null,
  skeletal_muscle_kg: null,
  lean_mass_kg: null,
  waist_hip_ratio: null,
  visceral_fat_level: null,
  bmr_kcal: null,
  balance_upper_lower: null,
  body_type: null,
  cid_type: null,
  note: null,
  created_at: "2026-09-01T16:00:00Z",
  ...over,
});

const history = [
  measurement({ measured_at: "2026-08-01", weight_kg: 72.4, body_fat_pct: 32 }),
  measurement({ measured_at: "2026-09-01", weight_kg: 70, body_fat_pct: 31.2 }),
  measurement({ measured_at: "2026-10-01", weight_kg: 68.5, body_fat_pct: null }),
];

const caption = () => screen.getByRole("figure").querySelector("figcaption")?.textContent;

describe("WeightTrendChart", () => {
  it("charts the weight by default and states its latest value as text", () => {
    render(<WeightTrendChart measurements={history} />);

    expect(caption()).toBe("Peso (kg)");
    expect(screen.getByRole("button", { name: "Peso" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Último valor: 68.5 kg el 1 oct 2026 · 3 mediciones")).toBeInTheDocument();
  });

  it("switches the one charted series with the segmented buttons", async () => {
    const user = userEvent.setup();
    render(<WeightTrendChart measurements={history} />);

    await user.click(screen.getByRole("button", { name: "% grasa" }));

    expect(caption()).toBe("Grasa corporal (%)");
    expect(screen.getByRole("button", { name: "% grasa" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Peso" })).toHaveAttribute("aria-pressed", "false");
    // The last measurement has no body fat: the series ends at 31.2.
    expect(
      screen.getByText("Último valor: 31.2 % el 1 sep 2026 · 2 mediciones"),
    ).toBeInTheDocument();
  });

  it("explains that one measurement is not a trend yet", async () => {
    const user = userEvent.setup();
    render(
      <WeightTrendChart
        measurements={[measurement({ measured_at: "2026-10-01", visceral_fat_level: 8 })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Grasa visceral" }));

    expect(
      screen.getByText(/Solo hay una medición: 8 el 1 oct 2026/),
    ).toBeInTheDocument();
  });

  it("says so when no measurement has the chosen value", async () => {
    const user = userEvent.setup();
    render(<WeightTrendChart measurements={history} />);

    await user.click(screen.getByRole("button", { name: "IMC" }));

    expect(screen.getByText("Aún no hay mediciones con este dato.")).toBeInTheDocument();
  });

  it("charts an all-equal series without breaking, stating the value as text", () => {
    render(
      <WeightTrendChart
        measurements={[
          measurement({ id: "a", measured_at: "2026-08-01", weight_kg: 70 }),
          measurement({ id: "b", measured_at: "2026-09-01", weight_kg: 70 }),
          measurement({ id: "c", measured_at: "2026-10-01", weight_kg: 70 }),
        ]}
      />,
    );

    expect(caption()).toBe("Peso (kg)");
    expect(screen.getByText("Último valor: 70.0 kg el 1 oct 2026 · 3 mediciones")).toBeInTheDocument();
  });
});
