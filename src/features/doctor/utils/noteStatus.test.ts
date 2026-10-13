import { describe, expect, it } from "vitest";
import { describeLateEntry } from "./noteStatus";

describe("describeLateEntry (NOM-004 5.10)", () => {
  it("says nothing for a note written on time", () => {
    expect(describeLateEntry({ recordedLate: false, finalizedAt: "2026-10-12T18:00:00Z" })).toBeNull();
    expect(describeLateEntry({ recordedLate: false, finalizedAt: null })).toBeNull();
  });

  it("gives the closing date and time of a late note", () => {
    const closedAt = new Date("2026-10-13T00:45:00Z").toLocaleString("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(describeLateEntry({ recordedLate: true, finalizedAt: "2026-10-13T00:45:00Z" })).toBe(
      `Registrada posteriormente · cerrada el ${closedAt}`,
    );
  });

  it("marks an open late note (a past visit) without a closing date", () => {
    expect(describeLateEntry({ recordedLate: true, finalizedAt: null })).toBe(
      "Registrada posteriormente",
    );
  });
});
