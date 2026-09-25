import { describe, expect, it } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  addNoteAddendum,
  fetchPatientHistory,
  finalizeConsultation,
  savePrescription,
  saveSoapNote,
} from "./soapService";

const FINALIZED_MESSAGE_START = "Esta consulta ya fue finalizada y no se puede modificar.";

const saveDraft = () =>
  saveSoapNote("appt-1", "patient-1", "Subjetivo", "Objetivo", "Análisis", "Plan");

describe("saveSoapNote (draft save)", () => {
  it("inserts a new note when the consultation has none, without finalizing", async () => {
    supabaseMock.onFrom("clinical_notes", { data: null }, { data: null });

    await saveDraft();

    const [lookup, insert] = supabaseMock.queries("clinical_notes");
    expect(lookup.args("eq")).toEqual(["appointment_id", "appt-1"]);
    expect(lookup.has("maybeSingle")).toBe(true);
    expect(insert.args("insert")).toEqual([
      [
        {
          appointment_id: "appt-1",
          patient_id: "patient-1",
          subjective: "Subjetivo",
          objective: "Objetivo",
          analysis: "Análisis",
          plan: "Plan",
        },
      ],
    ]);
    // A draft never freezes anything and never writes finalized_at itself.
    expect(supabaseMock.client.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(insert.ops)).not.toContain("finalized");
  });

  it("updates the existing draft note in place", async () => {
    supabaseMock.onFrom(
      "clinical_notes",
      { data: { id: "note-1", finalized_at: null } },
      { data: null },
    );

    await saveDraft();

    const update = supabaseMock.queries("clinical_notes")[1];
    expect(update.args("update")).toEqual([
      { subjective: "Subjetivo", objective: "Objetivo", analysis: "Análisis", plan: "Plan" },
    ]);
    expect(update.args("eq")).toEqual(["id", "note-1"]);
    expect(supabaseMock.client.rpc).not.toHaveBeenCalled();
  });

  it("refuses to touch a finalized note and explains how to correct it", async () => {
    supabaseMock.onFrom("clinical_notes", {
      data: { id: "note-1", finalized_at: "2026-09-20T16:00:00Z" },
    });

    await expect(saveDraft()).rejects.toThrow(FINALIZED_MESSAGE_START);
    expect(supabaseMock.queries("clinical_notes")).toHaveLength(1);
  });

  it("passes through the trigger's Spanish P0001 message", async () => {
    supabaseMock.onFrom(
      "clinical_notes",
      { data: null },
      { error: { message: "Mensaje del trigger", code: "P0001" } },
    );
    await expect(saveDraft()).rejects.toThrow(/^Mensaje del trigger$/);
  });

  it("prefixes unexpected database errors for debugging", async () => {
    supabaseMock.onFrom(
      "clinical_notes",
      { data: null },
      { error: { message: "network down", code: "08006" } },
    );
    await expect(saveDraft()).rejects.toThrow("Error creando nota: network down");
  });
});

describe("savePrescription", () => {
  const meds = [{ nombre: "Ibuprofeno", dosis: "400 mg", indicaciones: "Cada 8 h" }];

  it("does nothing when there are no medications", async () => {
    await savePrescription("appt-1", "patient-1", []);
    expect(supabaseMock.client.from).not.toHaveBeenCalled();
  });

  it("inserts, updates, or refuses like the SOAP note", async () => {
    supabaseMock.onFrom("prescriptions", { data: null }, { data: null });
    await savePrescription("appt-1", "patient-1", meds);
    expect(supabaseMock.queries("prescriptions")[1].args("insert")).toEqual([
      [{ appointment_id: "appt-1", patient_id: "patient-1", medications: meds }],
    ]);

    supabaseMock.onFrom(
      "prescriptions",
      { data: { id: "rx-1", finalized_at: "2026-09-20T16:00:00Z" } },
    );
    await expect(savePrescription("appt-1", "patient-1", meds)).rejects.toThrow(
      FINALIZED_MESSAGE_START,
    );
  });
});

describe("finalizeConsultation", () => {
  it("freezes the consultation through the finalize_consultation RPC only", async () => {
    await finalizeConsultation("appt-1");

    expect(supabaseMock.rpcCalls()).toEqual([
      { name: "finalize_consultation", args: { p_appointment_id: "appt-1" } },
    ]);
    expect(supabaseMock.client.from).not.toHaveBeenCalled();
  });

  it("surfaces the server's Spanish message", async () => {
    supabaseMock.onRpc("finalize_consultation", {
      error: { message: "Solo el personal de la clínica puede finalizar.", code: "P0001" },
    });
    await expect(finalizeConsultation("appt-1")).rejects.toThrow(
      /^Solo el personal de la clínica puede finalizar\.$/,
    );
  });
});

describe("fetchPatientHistory", () => {
  it("maps notes and prescriptions and attaches addenda to their note", async () => {
    supabaseMock.onFrom("clinical_notes", {
      data: [
        {
          id: "note-1",
          appointment_id: "appt-1",
          patient_id: "patient-1",
          subjective: "S",
          objective: "O",
          analysis: "A",
          plan: "P",
          created_at: "2026-09-20T16:00:00Z",
          finalized_at: "2026-09-20T17:00:00Z",
        },
      ],
    });
    supabaseMock.onFrom("prescriptions", {
      data: [
        {
          id: "rx-1",
          appointment_id: "appt-1",
          patient_id: "patient-1",
          medications: null,
          created_at: "2026-09-20T16:00:00Z",
        },
      ],
    });
    supabaseMock.onFrom("clinical_note_addenda", {
      data: [
        { id: "ad-1", note_id: "note-1", body: "Corrección", created_at: "2026-09-21T16:00:00Z" },
      ],
    });

    const history = await fetchPatientHistory("patient-1");

    expect(history.notes[0]).toMatchObject({
      id: "note-1",
      finalizedAt: "2026-09-20T17:00:00Z",
      addenda: [{ id: "ad-1", noteId: "note-1", body: "Corrección" }],
    });
    expect(history.prescriptions[0]).toMatchObject({ medications: [], finalizedAt: null });
    expect(supabaseMock.queries("clinical_note_addenda")[0].args("in")).toEqual([
      "note_id",
      ["note-1"],
    ]);
  });

  it("skips the addenda query when the patient has no notes", async () => {
    supabaseMock.onFrom("clinical_notes", { data: [] });
    supabaseMock.onFrom("prescriptions", { data: [] });

    await expect(fetchPatientHistory("patient-1")).resolves.toEqual({
      notes: [],
      prescriptions: [],
    });
    expect(supabaseMock.queries("clinical_note_addenda")).toHaveLength(0);
  });
});

describe("addNoteAddendum", () => {
  it("inserts a trimmed body and maps the stored row", async () => {
    supabaseMock.onFrom("clinical_note_addenda", {
      data: { id: "ad-1", note_id: "note-1", body: "Texto", created_at: "2026-09-21T16:00:00Z" },
    });

    await expect(addNoteAddendum("note-1", "  Texto  ")).resolves.toEqual({
      id: "ad-1",
      noteId: "note-1",
      body: "Texto",
      createdAt: "2026-09-21T16:00:00Z",
    });
    expect(supabaseMock.queries("clinical_note_addenda")[0].args("insert")).toEqual([
      { note_id: "note-1", body: "Texto" },
    ]);
  });
});
