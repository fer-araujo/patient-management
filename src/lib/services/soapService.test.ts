import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  addNoteAddendum,
  fetchPatientHistory,
  closeClinicalNote,
  fetchAppointmentNote,
  finalizeConsultationWithPayment,
  isNoteAwaitingClose,
  recordConsultationSupplies,
  findConsultationDraft,
  savePrescription,
  saveSoapNote,
  type PatientClinicalHistory,
  type Prescription,
  type SoapNote,
} from "./soapService";

const FINALIZED_MESSAGE_START = "Esta consulta ya fue finalizada y no se puede modificar.";

const vitals = { bp_sys: 120, bp_dia: 80, spo2: 98, weight_kg: 70.5 };

const saveDraft = () =>
  saveSoapNote("appt-1", "patient-1", {
    subjective: "Subjetivo",
    objective: "Objetivo",
    analysis: "Análisis",
    plan: "Plan",
    prognosis: "Favorable",
    vitalSigns: vitals,
  });

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
          prognosis: "Favorable",
          vital_signs: vitals,
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
      {
        subjective: "Subjetivo",
        objective: "Objetivo",
        analysis: "Análisis",
        plan: "Plan",
        prognosis: "Favorable",
        vital_signs: vitals,
      },
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

describe("finalizeConsultationWithPayment", () => {
  it("charges and finalizes through ONE rpc call", async () => {
    await finalizeConsultationWithPayment("appt-1", {
      status: "paid",
      amount: 800,
      method: "cash",
      note: "  Pagó completo ",
    });
    await finalizeConsultationWithPayment("appt-2", {
      status: "courtesy",
      amount: 800,
      method: "card",
      note: "",
    });

    expect(supabaseMock.rpcCalls()).toEqual([
      {
        name: "finalize_consultation_with_payment",
        args: {
          p_appointment_id: "appt-1",
          p_status: "paid",
          p_amount: 800,
          p_method: "cash",
          p_note: "Pagó completo",
        },
      },
      {
        name: "finalize_consultation_with_payment",
        args: {
          p_appointment_id: "appt-2",
          p_status: "courtesy",
          p_amount: 0,
          p_method: null,
          p_note: null,
        },
      },
    ]);
    expect(supabaseMock.client.from).not.toHaveBeenCalled();
  });

  it("sends the supplies used as item and quantity only, leaving out zeros", async () => {
    await finalizeConsultationWithPayment("appt-1", {
      status: "courtesy",
      supplies: [
        { itemId: "item-s", quantity: 1 },
        { itemId: "item-j", quantity: 0 },
        { itemId: "item-g", quantity: 3 },
      ],
    });

    expect(supabaseMock.lastRpc("finalize_consultation_with_payment")?.args).toEqual({
      p_appointment_id: "appt-1",
      p_status: "courtesy",
      p_amount: 0,
      p_method: null,
      p_note: null,
      // Never a cost: the server computes it from the purchases.
      p_supplies: [
        { item_id: "item-s", quantity: 1 },
        { item_id: "item-g", quantity: 3 },
      ],
    });
  });

  it("sends an EMPTY list when she confirmed no supplies, and nothing when the step was skipped", async () => {
    await finalizeConsultationWithPayment("appt-1", { status: "courtesy", supplies: [] });
    await finalizeConsultationWithPayment("appt-2", { status: "courtesy" });

    const [confirmed, skipped] = supabaseMock.rpcCalls("finalize_consultation_with_payment");
    // [] marks the consultation as "used none" on the server.
    expect(confirmed.args?.p_supplies).toEqual([]);
    // Left out: the server keeps the consultation pending for "Registrar insumos".
    expect(skipped.args).not.toHaveProperty("p_supplies");
  });

  it("surfaces the stock refusal of the server as is", async () => {
    supabaseMock.onRpc("finalize_consultation_with_payment", {
      error: { message: 'Solo hay 2 de "Sculptra" en inventario.', code: "P0001" },
    });
    await expect(
      finalizeConsultationWithPayment("appt-1", {
        status: "courtesy",
        supplies: [{ itemId: "item-s", quantity: 5 }],
      }),
    ).rejects.toThrow('Solo hay 2 de "Sculptra" en inventario.');
  });

  it("surfaces the server's Spanish reason, and a clear message otherwise", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("finalize_consultation_with_payment", {
      error: {
        message: "Para finalizar la consulta, escribe el diagnóstico y el plan.",
        code: "P0001",
      },
    });
    await expect(
      finalizeConsultationWithPayment("appt-1", { status: "courtesy" }),
    ).rejects.toThrow(/^Para finalizar la consulta, escribe el diagnóstico y el plan\.$/);

    supabaseMock.onRpc("finalize_consultation_with_payment", {
      error: { message: "connection reset", code: "08006" },
    });
    await expect(
      finalizeConsultationWithPayment("appt-1", { status: "courtesy" }),
    ).rejects.toThrow("No se pudo finalizar la consulta. No se guardó nada; intenta de nuevo.");
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
          prognosis: "Favorable",
          vital_signs: { bp_sys: 120, bp_dia: 80 },
          author_id: "doc-1",
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
        {
          id: "ad-1",
          note_id: "note-1",
          body: "Corrección",
          created_at: "2026-09-21T16:00:00Z",
          author_id: "doc-1",
        },
      ],
    });
    supabaseMock.onFrom("profiles", {
      data: [{ id: "doc-1", first_name: "Laura", last_name: "Garza" }],
    });

    const history = await fetchPatientHistory("patient-1");

    expect(history.notes[0]).toMatchObject({
      id: "note-1",
      prognosis: "Favorable",
      vitalSigns: { bp_sys: 120, bp_dia: 80 },
      authorName: "Laura Garza",
      finalizedAt: "2026-09-20T17:00:00Z",
      // Rows read before migration 31 have neither marker.
      consultationFinalizedAt: null,
      recordedLate: false,
      addenda: [
        { id: "ad-1", noteId: "note-1", body: "Corrección", authorName: "Laura Garza" },
      ],
    });
    // One lookup for every author, notes and addenda together.
    const profiles = supabaseMock.queries("profiles");
    expect(profiles).toHaveLength(1);
    expect(profiles[0].args("in")).toEqual(["id", ["doc-1"]]);
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
    expect(supabaseMock.queries("profiles")).toHaveLength(0);
  });

  it("still loads the history when author names cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onFrom("clinical_notes", {
      data: [
        {
          id: "note-1",
          appointment_id: "appt-1",
          patient_id: "patient-1",
          analysis: "A",
          author_id: "doc-1",
          created_at: "2026-09-20T16:00:00Z",
        },
      ],
    });
    supabaseMock.onFrom("prescriptions", { data: [] });
    supabaseMock.onFrom("clinical_note_addenda", { data: [] });
    supabaseMock.onFrom("profiles", { error: { message: "denied", code: "42501" } });

    const history = await fetchPatientHistory("patient-1");

    expect(history.notes[0]).toMatchObject({
      id: "note-1",
      authorName: null,
      prognosis: null,
      vitalSigns: null,
    });
  });
});

describe("findConsultationDraft", () => {
  const note = (over: Partial<SoapNote>): SoapNote => ({
    id: "n",
    appointmentId: "appt-1",
    patientId: "patient-1",
    subjective: null,
    objective: null,
    analysis: null,
    plan: null,
    prognosis: null,
    vitalSigns: null,
    createdAt: "2026-09-20T16:00:00Z",
    authorName: null,
    finalizedAt: null,
    consultationFinalizedAt: null,
    recordedLate: false,
    addenda: [],
    ...over,
  });
  const rx = (over: Partial<Prescription>): Prescription => ({
    id: "rx",
    appointmentId: "appt-1",
    patientId: "patient-1",
    medications: [],
    createdAt: "2026-09-20T16:00:00Z",
    finalizedAt: null,
    ...over,
  });

  it("returns the oldest unfinalized note and prescription of that appointment", () => {
    const history: PatientClinicalHistory = {
      notes: [
        note({ id: "newer", createdAt: "2026-09-20T18:00:00Z" }),
        note({ id: "other-appt", appointmentId: "appt-0" }),
        note({ id: "oldest", createdAt: "2026-09-20T16:00:00Z" }),
      ],
      prescriptions: [rx({ id: "rx-1" }), rx({ id: "rx-other", appointmentId: "appt-0" })],
    };

    const draft = findConsultationDraft(history, "appt-1");

    expect(draft.note?.id).toBe("oldest");
    expect(draft.prescription?.id).toBe("rx-1");
  });

  it("never returns a finalized record as a draft", () => {
    const history: PatientClinicalHistory = {
      notes: [note({ finalizedAt: "2026-09-20T17:00:00Z" })],
      prescriptions: [rx({ finalizedAt: "2026-09-20T17:00:00Z" })],
    };

    expect(findConsultationDraft(history, "appt-1")).toEqual({
      note: null,
      prescription: null,
    });
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

describe("recordConsultationSupplies", () => {
  it('"Registrar insumos" sends item and quantity only, through its own rpc', async () => {
    await recordConsultationSupplies("appt-9", [
      { itemId: "item-s", quantity: 2 },
      { itemId: "item-j", quantity: 0 },
    ]);

    expect(supabaseMock.rpcCalls()).toEqual([
      {
        name: "record_consultation_supplies",
        args: {
          p_appointment_id: "appt-9",
          p_supplies: [{ item_id: "item-s", quantity: 2 }],
        },
      },
    ]);
  });

  it("shows the refusal of a second call, and a clear message otherwise", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("record_consultation_supplies", {
      error: { code: "P0001", message: "Los insumos de esta consulta ya estaban registrados." },
    });
    await expect(recordConsultationSupplies("appt-9", [])).rejects.toThrow(
      /^Los insumos de esta consulta ya estaban registrados\.$/,
    );

    supabaseMock.onRpc("record_consultation_supplies", {
      error: { code: "08006", message: "connection reset" },
    });
    await expect(recordConsultationSupplies("appt-9", [])).rejects.toThrow(
      "No se pudieron registrar los insumos. Intenta de nuevo.",
    );
  });
});

describe("open clinical notes (migration 31)", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    id: "note-1",
    appointment_id: "appt-1",
    patient_id: "patient-1",
    subjective: "S",
    objective: null,
    analysis: null,
    plan: null,
    prognosis: null,
    vital_signs: null,
    author_id: "doc-1",
    created_at: "2026-10-12T16:00:00Z",
    finalized_at: null,
    consultation_finalized_at: "2026-10-12T17:00:00Z",
    recorded_late: true,
    ...over,
  });

  it("maps the consultation marker and the late-entry flag of each note", async () => {
    supabaseMock.onFrom("clinical_notes", { data: [raw()] });
    supabaseMock.onFrom("prescriptions", { data: [] });

    const history = await fetchPatientHistory("patient-1");

    expect(history.notes[0]).toMatchObject({
      finalizedAt: null,
      consultationFinalizedAt: "2026-10-12T17:00:00Z",
      recordedLate: true,
    });
  });

  it("an open note waits to be closed only after Finalizar Consulta or a past visit", () => {
    const base = { finalizedAt: null, consultationFinalizedAt: null, recordedLate: false };
    expect(isNoteAwaitingClose({ ...base, consultationFinalizedAt: "2026-10-12T17:00:00Z" })).toBe(true);
    expect(isNoteAwaitingClose({ ...base, recordedLate: true })).toBe(true);
    // A draft of a consultation still in progress.
    expect(isNoteAwaitingClose(base)).toBe(false);
    // A closed note.
    expect(
      isNoteAwaitingClose({
        finalizedAt: "2026-10-13T10:00:00Z",
        consultationFinalizedAt: "2026-10-12T17:00:00Z",
        recordedLate: true,
      }),
    ).toBe(false);
  });

  it("closeClinicalNote closes through its own rpc and returns the server stamps", async () => {
    supabaseMock.onRpc("close_clinical_note", {
      data: { ...raw(), finalized_at: "2026-10-14T18:00:00Z", recorded_late: true },
    });

    await expect(closeClinicalNote("note-1")).resolves.toEqual({
      finalizedAt: "2026-10-14T18:00:00Z",
      recordedLate: true,
    });
    expect(supabaseMock.lastRpc("close_clinical_note")?.args).toEqual({ p_note_id: "note-1" });
    // Never a direct write of finalized_at from the browser.
    expect(supabaseMock.queries("clinical_notes")).toHaveLength(0);
  });

  it("closeClinicalNote shows the server's Spanish reason, and a clear message otherwise", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseMock.onRpc("close_clinical_note", {
      error: { message: "Para cerrar la nota, escribe el diagnóstico y el plan.", code: "P0001" },
    });
    await expect(closeClinicalNote("note-1")).rejects.toThrow(
      "Para cerrar la nota, escribe el diagnóstico y el plan.",
    );

    supabaseMock.onRpc("close_clinical_note", {
      error: { message: "permission denied", code: "42501" },
    });
    await expect(closeClinicalNote("note-1")).rejects.toThrow(
      "No se pudo cerrar la nota. Intenta de nuevo.",
    );
  });

  it("fetchAppointmentNote reads the oldest note of that appointment, or null", async () => {
    supabaseMock.onFrom("clinical_notes", { data: raw() });

    const loaded = await fetchAppointmentNote("appt-1");

    expect(loaded).toMatchObject({ id: "note-1", recordedLate: true, addenda: [] });
    const query = supabaseMock.queries("clinical_notes")[0];
    expect(query.args("eq")).toEqual(["appointment_id", "appt-1"]);
    expect(query.args("order")).toEqual(["created_at", { ascending: true }]);

    supabaseMock.onFrom("clinical_notes", { data: null });
    await expect(fetchAppointmentNote("appt-2")).resolves.toBeNull();
  });
});
