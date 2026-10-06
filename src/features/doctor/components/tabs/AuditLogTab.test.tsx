import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fetchAuditLog, type AuditEntry } from "../../../../lib/services/privacyService";
import { fetchPatients } from "../../../../lib/services/patientService";
import { AuditLogTab } from "./AuditLogTab";

vi.mock("../../../../lib/services/privacyService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/services/privacyService")>()),
  fetchAuditLog: vi.fn(),
}));

vi.mock("../../../../lib/services/patientService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/services/patientService")>()),
  fetchPatients: vi.fn(),
}));

let nextId = 1;
const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: nextId++,
  occurredAt: "2026-10-05T17:00:00Z",
  actorRole: "doctor",
  action: "EXPORT",
  tableName: "prescriptions",
  rowId: "rx-1",
  patientId: null,
  changedColumns: [],
  ...over,
});

const ISSUED = "issued_at:2026-10-05T17:00:00Z";

beforeEach(() => {
  nextId = 1;
  vi.mocked(fetchPatients).mockResolvedValue([]);
});

const renderWith = async (entries: AuditEntry[]) => {
  vi.mocked(fetchAuditLog).mockResolvedValue(entries);
  render(<AuditLogTab />);
  await screen.findAllByText("La doctora");
};

describe("AuditLogTab prescription events", () => {
  it("names each way the prescription PDF left, with its folio", async () => {
    await renderWith([
      entry({ changedColumns: ["share_sheet", "folio:000123", ISSUED] }),
      entry({ changedColumns: ["whatsapp_link", "folio:000123", ISSUED] }),
      entry({ changedColumns: ["download", "folio:000124", ISSUED] }),
      entry({ changedColumns: ["print", "folio:1234567", ISSUED] }),
    ]);

    expect(screen.getByText("Compartió la receta en PDF (folio 000123)")).toBeInTheDocument();
    expect(
      screen.getByText("Descargó la receta en PDF y abrió WhatsApp (folio 000123)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Descargó la receta en PDF (folio 000124)")).toBeInTheDocument();
    expect(
      screen.getByText("Abrió la receta en PDF para ver o imprimir (folio 1234567)"),
    ).toBeInTheDocument();
    // Never the patient's data download label.
    expect(screen.queryByText("Descargó una copia de sus datos")).not.toBeInTheDocument();
  });

  it("an event with only a channel, or an unknown or blank one, still reads well", async () => {
    await renderWith([
      // Channel only, no folio.
      entry({ changedColumns: ["print"] }),
      // Unknown channel and a blank folio.
      entry({ changedColumns: ["fax", "folio:  "] }),
      // Nothing at all.
      entry({ changedColumns: [] }),
    ]);

    expect(screen.getByText("Abrió la receta en PDF para ver o imprimir")).toBeInTheDocument();
    expect(screen.getAllByText("Emitió la receta en PDF")).toHaveLength(2);
  });

  it("labels the first issue and keeps other events as they were", async () => {
    await renderWith([
      entry({
        action: "UPDATE",
        changedColumns: ["prescriber_snapshot", "signature_path", "issued_at", "folio"],
      }),
      entry({ action: "UPDATE", changedColumns: ["medications"] }),
      entry({ action: "EXPORT", tableName: "patients", changedColumns: [] }),
      entry({ action: "UPDATE", tableName: "prescriber_profile", changedColumns: ["full_name"] }),
    ]);

    expect(screen.getByText("Emitió la receta oficial (asignó folio)")).toBeInTheDocument();
    expect(
      screen.getByText("datos impresos de la receta, firma, emisión, folio"),
    ).toBeInTheDocument();
    expect(screen.getByText("Modificó las indicaciones médicas")).toBeInTheDocument();
    expect(screen.getByText("Descargó una copia de sus datos")).toBeInTheDocument();
    expect(screen.getByText("Modificó los datos de la receta")).toBeInTheDocument();
    expect(screen.getByText("nombre completo")).toBeInTheDocument();
  });
});
