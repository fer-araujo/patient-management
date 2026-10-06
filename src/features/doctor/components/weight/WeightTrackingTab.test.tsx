import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createBodyMeasurement,
  deleteBodyMeasurement,
  listBodyMeasurements,
  updateBodyMeasurement,
  type BodyMeasurement,
} from "../../../../lib/services/bodyMeasurementService";
import type { BodySex } from "../../utils/bodyComposition";
import { WeightTrackingTab } from "./WeightTrackingTab";

vi.mock("../../../../lib/services/bodyMeasurementService", () => ({
  listBodyMeasurements: vi.fn(),
  createBodyMeasurement: vi.fn(),
  updateBodyMeasurement: vi.fn(),
  deleteBodyMeasurement: vi.fn(),
}));

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const measurement = (over: Partial<BodyMeasurement>): BodyMeasurement => ({
  id: "m",
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

const older = measurement({
  id: "m1",
  measured_at: "2026-09-01",
  weight_kg: 70,
  height_cm: 170,
  bmi: 24.2,
  body_fat_pct: 31,
});
const latest = measurement({
  id: "m2",
  measured_at: "2026-10-01",
  weight_kg: 68.5,
  height_cm: 170,
  bmi: 23.7,
  body_fat_pct: 30.5,
  visceral_fat_level: 10,
  body_type: "sobrepeso",
  created_at: "2026-10-01T16:00:00Z",
});

const renderTab = (
  props: Partial<Parameters<typeof WeightTrackingTab>[0]> & { sex?: BodySex } = {},
) => {
  const onStopTracking = vi.fn().mockResolvedValue(undefined);
  render(
    <WeightTrackingTab
      patientId="p1"
      patientName="Ana Pérez"
      sex="female"
      readOnly={false}
      onStopTracking={onStopTracking}
      {...props}
    />,
  );
  return { user: userEvent.setup(), onStopTracking };
};

// The clinic's "today" for every test: 4 Oct 2026, noon in Monterrey. Only
// Date is faked, so userEvent and the promises keep working.
const TODAY = "2026-10-04";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T12:00:00-06:00"));
  vi.mocked(listBodyMeasurements).mockResolvedValue([latest, older]);
});

const echoUpdate = (base: BodyMeasurement) =>
  vi.mocked(updateBodyMeasurement).mockImplementation(async (id, input) => ({
    ...base,
    ...input,
    id,
  }));

const echoCreate = () =>
  vi.mocked(createBodyMeasurement).mockImplementation(async (patientId, input) => ({
    ...measurement({}),
    ...input,
    id: "new",
    patient_id: patientId,
    created_at: "2026-10-04T16:00:00Z",
  }));

/** Opens the date picker of the open form and picks `day` of the shown month. */
const pickDay = async (user: ReturnType<typeof userEvent.setup>, day: string) => {
  await user.click(screen.getByLabelText(/Fecha/));
  await user.click(screen.getByRole("button", { name: day }));
  await user.click(screen.getByRole("button", { name: "OK" }));
};

describe("WeightTrackingTab", () => {
  it("records a new measurement linked to today's consultation", async () => {
    vi.mocked(listBodyMeasurements).mockResolvedValue([]);
    vi.mocked(createBodyMeasurement).mockImplementation(async (patientId, input) => ({
      ...measurement({}),
      ...input,
      id: "new",
      patient_id: patientId,
      bmi: null,
      created_at: "2026-10-04T16:00:00Z",
    }));
    const { user } = renderTab({
      appointment: { id: "appt-1", date: TODAY },
      prefill: { weight: "70" },
    });

    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));
    const weight = screen.getByLabelText(/Peso \(kg\)/);
    // Pre-filled from the consultation's vital signs.
    expect(weight).toHaveValue("70");
    expect(weight).toHaveAttribute("inputmode", "decimal");
    await user.clear(weight);
    await user.type(weight, "68,5");
    await user.type(screen.getByLabelText("Grasa visceral (nivel)"), "8");
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));

    await waitFor(() => expect(createBodyMeasurement).toHaveBeenCalledTimes(1));
    expect(createBodyMeasurement).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        measured_at: TODAY,
        appointment_id: "appt-1",
        weight_kg: 68.5,
        visceral_fat_level: 8,
        body_fat_pct: null,
      }),
    );
    // The modal closes and the new measurement is shown.
    await waitFor(() => expect(screen.queryByLabelText(/Peso \(kg\)/)).toBeNull());
    expect(screen.getByRole("heading", { name: "Última medición" })).toBeInTheDocument();
  });

  it("does not link a measurement of today to a consultation of another day", async () => {
    echoCreate();
    // A consultation of 1 Oct reopened on 4 Oct.
    const { user } = renderTab({
      appointment: { id: "appt-oct1", date: "2026-10-01" },
      prefill: { weight: "70" },
    });

    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));

    await waitFor(() =>
      expect(createBodyMeasurement).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ measured_at: TODAY, appointment_id: null }),
      ),
    );
  });

  it("links a measurement dated on the consultation's own day, even when it is not today", async () => {
    echoCreate();
    const { user } = renderTab({
      appointment: { id: "appt-oct2", date: "2026-10-02" },
      prefill: { weight: "70" },
    });

    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));
    await pickDay(user, "2");
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));

    await waitFor(() =>
      expect(createBodyMeasurement).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ measured_at: "2026-10-02", appointment_id: "appt-oct2" }),
      ),
    );
  });

  it("links an edit moved onto the consultation's day, and unlinks one moved off it", async () => {
    const linked = measurement({
      id: "m3",
      measured_at: TODAY,
      appointment_id: "appt-1",
      weight_kg: 69,
      created_at: "2026-10-04T16:00:00Z",
    });
    vi.mocked(listBodyMeasurements).mockResolvedValue([linked, latest, older]);
    echoUpdate(latest);
    const { user } = renderTab({ appointment: { id: "appt-1", date: TODAY } });

    // 1 Oct -> 4 Oct (the consultation's day): linked.
    await user.click(
      await screen.findByRole("button", { name: "Editar la medición del 1 oct 2026" }),
    );
    await pickDay(user, "4");
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));
    await waitFor(() =>
      expect(updateBodyMeasurement).toHaveBeenLastCalledWith(
        "m2",
        expect.objectContaining({ measured_at: TODAY, appointment_id: "appt-1" }),
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText(/Peso \(kg\)/)).toBeNull());

    // 4 Oct -> 3 Oct: no longer the consultation's day, unlinked.
    echoUpdate(linked);
    await user.click(
      screen.getAllByRole("button", { name: "Editar la medición del 4 oct 2026" })[0],
    );
    await pickDay(user, "3");
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));
    await waitFor(() =>
      expect(updateBodyMeasurement).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ measured_at: "2026-10-03", appointment_id: null }),
      ),
    );
  });

  it("caps the weight at one decimal, the precision the screen shows", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));

    const weight = screen.getByLabelText(/Peso \(kg\)/);
    await user.clear(weight);
    await user.type(weight, "70.25");

    expect(weight).toHaveValue("70.2");
  });

  it("shows a future date as an inline error and saves nothing", async () => {
    const future = measurement({ id: "m9", measured_at: "2026-10-10", weight_kg: 69 });
    vi.mocked(listBodyMeasurements).mockResolvedValue([older, future]);
    const { user } = renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Editar la medición del 10 oct 2026" }),
    );
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "La fecha de la medición no puede ser futura.",
    );
    expect(updateBodyMeasurement).not.toHaveBeenCalled();
    // The form stays open to fix it.
    expect(screen.getByLabelText(/Peso \(kg\)/)).toBeInTheDocument();
  });

  it("orders same-day measurements by when they were recorded and compares with the earlier one", async () => {
    const morning = measurement({
      id: "am",
      measured_at: TODAY,
      weight_kg: 70,
      created_at: "2026-10-04T15:00:00Z",
    });
    const afternoon = measurement({
      id: "pm",
      measured_at: TODAY,
      weight_kg: 69,
      created_at: "2026-10-04T21:00:00Z",
    });
    // Served out of order on purpose.
    vi.mocked(listBodyMeasurements).mockResolvedValue([afternoon, older, morning]);
    renderTab();

    const weight = await screen.findByRole("listitem", { name: "Peso" });
    expect(weight).toHaveTextContent("69.0");
    expect(weight).toHaveTextContent("▼ 1.0 kg desde el 4 oct 2026");

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual([
      "69.0",
      "70.0",
      "70.0",
    ]);
  });

  it("cannot be dismissed while a delete is in flight", async () => {
    let finishDelete!: () => void;
    vi.mocked(deleteBodyMeasurement).mockReturnValue(
      new Promise<void>((resolve) => {
        finishDelete = resolve;
      }),
    );
    const { user } = renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Borrar la medición del 1 sep 2026" }),
    );
    await user.click(screen.getByRole("button", { name: "Sí, borrar" }));

    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sí, borrar" })).toBeDisabled();

    finishDelete();

    await waitFor(() =>
      expect(screen.queryByText("¿Borrar la medición del 1 sep 2026?")).toBeNull(),
    );
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  it("cannot be closed while a measurement is being saved, then closes with the result", async () => {
    let finishCreate!: () => void;
    vi.mocked(createBodyMeasurement).mockImplementation(
      (patientId, input) =>
        new Promise((resolve) => {
          finishCreate = () =>
            resolve({
              ...measurement({}),
              ...input,
              id: "new",
              patient_id: patientId,
              created_at: "2026-10-04T16:00:00Z",
            });
        }),
    );
    const { user } = renderTab({ prefill: { weight: "70" } });
    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));

    // Cancelar is disabled and the header's close button does nothing.
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    const header = screen.getByRole("heading", { name: "Nueva medición" }).parentElement!
      .parentElement!;
    await user.click(within(header).getByRole("button"));
    expect(screen.getByLabelText(/Peso \(kg\)/)).toBeInTheDocument();

    finishCreate();

    await waitFor(() => expect(screen.queryByLabelText(/Peso \(kg\)/)).toBeNull());
    expect(screen.getByRole("heading", { name: "Última medición" })).toBeInTheDocument();
  });

  it("pre-fills the height of the last measurement when the consultation has none", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));
    expect(screen.getByLabelText("Talla (cm)")).toHaveValue("170");
  });

  it("refuses a measurement without a weight and saves nothing", async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("Escribe el peso en kilos.");
    expect(createBodyMeasurement).not.toHaveBeenCalled();
  });

  it("keeps the form open with the database's reason when saving fails", async () => {
    vi.mocked(createBodyMeasurement).mockRejectedValue(
      new Error("Este expediente fue anonimizado. Sus datos ya no se pueden editar."),
    );
    const { user } = renderTab({ prefill: { weight: "70" } });
    await user.click(await screen.findByRole("button", { name: /Nueva medición/ }));
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Este expediente fue anonimizado");
    expect(screen.getByLabelText(/Peso \(kg\)/)).toBeInTheDocument();
  });

  it("shows the latest measurement with its level and the change since the previous one", async () => {
    renderTab();

    const bmi = await screen.findByRole("listitem", { name: "IMC" });
    expect(bmi).toHaveTextContent("23.7");
    expect(bmi).toHaveTextContent("Normal");
    expect(bmi).toHaveTextContent("▼ 0.5 kg/m² desde el 1 sep 2026");
    expect(within(bmi).getByRole("img")).toHaveAccessibleName(
      "IMC 23.7 kg/m²: Normal (normal de 18.5 a 24.9)",
    );

    // Women: normal body fat 18-28 %.
    const fat = screen.getByRole("listitem", { name: "Grasa corporal" });
    expect(fat).toHaveTextContent("Alto");
    expect(fat).toHaveTextContent("▼ 0.5 % desde el 1 sep 2026");

    const visceral = screen.getByRole("listitem", { name: "Grasa visceral" });
    expect(visceral).toHaveTextContent("Alto");
    expect(visceral).toHaveTextContent("Sin medición anterior");
    // No "low" zone on the visceral bar.
    expect(within(visceral).queryByText("Bajo")).toBeNull();

    const weight = screen.getByRole("listitem", { name: "Peso" });
    expect(weight).toHaveTextContent("▼ 1.5 kg desde el 1 sep 2026");
    expect(within(weight).queryByRole("img")).toBeNull();

    expect(screen.getByText("Sobrepeso")).toBeInTheDocument();
  });

  it("shows body fat without zones when the sex is unknown", async () => {
    renderTab({ sex: null });

    const fat = await screen.findByRole("listitem", { name: "Grasa corporal" });
    expect(fat).toHaveTextContent("30.5");
    expect(within(fat).queryByRole("img")).toBeNull();
    expect(fat).not.toHaveTextContent("Alto");
    expect(
      screen.getByText(/Registra el sexo del paciente para ver los rangos/),
    ).toBeInTheDocument();
  });

  it("lists every measurement, newest first, with labelled actions", async () => {
    renderTab();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("1 oct 2026");
    expect(rows[0]).toHaveTextContent("68.5");
    expect(rows[1]).toHaveTextContent("1 sep 2026");
    expect(
      within(rows[0]).getByRole("button", { name: "Editar la medición del 1 oct 2026" }),
    ).toHaveTextContent("Editar");
    expect(
      within(rows[0]).getByRole("button", { name: "Borrar la medición del 1 oct 2026" }),
    ).toHaveTextContent("Borrar");
  });

  it("corrects a measurement keeping its date", async () => {
    echoUpdate(older);
    const { user } = renderTab({ appointment: { id: "appt-9", date: TODAY } });

    await user.click(
      await screen.findByRole("button", { name: "Editar la medición del 1 sep 2026" }),
    );
    const weight = screen.getByLabelText(/Peso \(kg\)/);
    expect(weight).toHaveValue("70");
    await user.clear(weight);
    await user.type(weight, "70.4");
    await user.click(screen.getByRole("button", { name: /Guardar medición/ }));

    await waitFor(() =>
      expect(updateBodyMeasurement).toHaveBeenCalledWith(
        "m1",
        expect.objectContaining({
          measured_at: "2026-09-01",
          weight_kg: 70.4,
          // A past measurement is never linked to this consultation.
          appointment_id: null,
        }),
      ),
    );
  });

  it("deletes a measurement only after confirmation", async () => {
    vi.mocked(deleteBodyMeasurement).mockResolvedValue();
    const { user } = renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Borrar la medición del 1 sep 2026" }),
    );
    expect(deleteBodyMeasurement).not.toHaveBeenCalled();
    expect(screen.getByText("¿Borrar la medición del 1 sep 2026?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sí, borrar" }));

    await waitFor(() => expect(deleteBodyMeasurement).toHaveBeenCalledWith("m1"));
    await waitFor(() =>
      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2),
    );
  });

  it("stops tracking after confirmation", async () => {
    const { user, onStopTracking } = renderTab();

    await user.click(await screen.findByRole("button", { name: "Dejar de llevar control" }));
    expect(onStopTracking).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sí, dejar de llevarlo" }));

    await waitFor(() => expect(onStopTracking).toHaveBeenCalledTimes(1));
  });

  it("is read-only for an anonymized record", async () => {
    renderTab({ readOnly: true });

    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Nueva medición/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar la medición/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Borrar la medición/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dejar de llevar control" })).toBeNull();
  });

  it("says so when the measurements cannot be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listBodyMeasurements).mockRejectedValue(new Error("x"));
    renderTab();

    expect(
      await screen.findByText(/No se pudieron cargar las mediciones/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nueva medición/ })).toBeDisabled();
  });
});
