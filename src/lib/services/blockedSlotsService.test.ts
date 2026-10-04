import { describe, expect, it } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  createBlockedSlot,
  updateBlockedSlot,
  validateBlockRange,
} from "./blockedSlotsService";

describe("createBlockedSlot", () => {
  it("inserts one row per day, in Monterrey time", async () => {
    await createBlockedSlot("2026-10-15", "09:00 AM", "2026-10-16", "10:00 AM", "vacaciones");

    const insert = supabaseMock.queries("blocked_slots")[0].args("insert");
    expect(insert).toEqual([
      [
        {
          start_time: "2026-10-15T15:00:00.000Z",
          end_time: "2026-10-15T16:00:00.000Z",
          reason: "vacaciones",
        },
        {
          start_time: "2026-10-16T15:00:00.000Z",
          end_time: "2026-10-16T16:00:00.000Z",
          reason: "vacaciones",
        },
      ],
    ]);
  });

  it("throws instead of inserting zero rows when the end date is before the start date", async () => {
    await expect(
      createBlockedSlot("2026-10-16", "09:00 AM", "2026-10-15", "10:00 AM", "junta"),
    ).rejects.toThrow("La fecha final no puede ser antes de la fecha inicial.");
    expect(supabaseMock.queries("blocked_slots")).toHaveLength(0);
  });

  it("throws when the end time is not after the start time", async () => {
    await expect(
      createBlockedSlot("2026-10-15", "10:00 AM", "2026-10-15", "10:00 AM", "junta"),
    ).rejects.toThrow("La hora de fin debe ser después de la hora de inicio.");
    expect(supabaseMock.queries("blocked_slots")).toHaveLength(0);
  });
});

describe("updateBlockedSlot", () => {
  it("keeps the original block when the new range is invalid", async () => {
    await expect(
      updateBlockedSlot("b1", "2026-10-15", "11:00 AM", "2026-10-15", "09:00 AM", "comida"),
    ).rejects.toThrow("La hora de fin debe ser después de la hora de inicio.");
    expect(supabaseMock.queries("blocked_slots")).toHaveLength(0);
  });
});

describe("validateBlockRange", () => {
  it("accepts a same-day range that ends after it starts", () => {
    expect(validateBlockRange("2026-10-15", "09:00 AM", "2026-10-15", "09:30 AM")).toBeNull();
  });

  it("asks for both dates", () => {
    expect(validateBlockRange("", "09:00 AM", "2026-10-15", "10:00 AM")).toBe(
      "Seleccione las fechas del bloqueo.",
    );
  });
});
