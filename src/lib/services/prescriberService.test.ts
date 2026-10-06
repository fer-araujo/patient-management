import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  PrescriberIncompleteError,
  SIGNATURE_BUCKET,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_OBJECT_PATTERN,
  downloadSignature,
  fetchPrescriberProfile,
  issuePrescription,
  logPrescriptionShared,
  newSignatureObjectName,
  savePrescriberProfile,
  uploadSignature,
  type PrescriberProfileFields,
} from "./prescriberService";

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

const fields: PrescriberProfileFields = {
  fullName: " Dra. Carmen Torres ",
  cedulaProfesional: "123 4567",
  especialidad: "Dermatología",
  cedulaEspecialidad: "7654321",
  institucionTitulo: "UANL",
  consultorioDomicilio: "Av. Constitución 100",
  telefono: "",
};

describe("fetchPrescriberProfile", () => {
  it("maps the single row and says whether a signature exists", async () => {
    supabaseMock.onFrom("prescriber_profile", {
      data: {
        full_name: "Dra. Carmen Torres",
        cedula_profesional: "1234567",
        especialidad: null,
        cedula_especialidad: null,
        institucion_titulo: "UANL",
        consultorio_domicilio: "Av. Constitución 100",
        telefono: null,
        signature_path: "signature-abc123.png",
      },
    });

    const profile = await fetchPrescriberProfile();

    expect(profile).toEqual({
      fullName: "Dra. Carmen Torres",
      cedulaProfesional: "1234567",
      especialidad: "",
      cedulaEspecialidad: "",
      institucionTitulo: "UANL",
      consultorioDomicilio: "Av. Constitución 100",
      telefono: "",
      hasSignature: true,
      signaturePath: "signature-abc123.png",
    });
    expect(supabaseMock.queries("prescriber_profile")[0].has("maybeSingle")).toBe(true);
  });

  it("returns an empty profile when nothing was saved yet", async () => {
    supabaseMock.onFrom("prescriber_profile", { data: null });
    const profile = await fetchPrescriberProfile();
    expect(profile.fullName).toBe("");
    expect(profile.hasSignature).toBe(false);
    expect(profile.signaturePath).toBe("");
  });

  it("throws a Spanish message and logs only the code", async () => {
    const spy = quiet();
    supabaseMock.onFrom("prescriber_profile", {
      error: { message: "permission denied for table prescriber_profile", code: "42501" },
    });
    await expect(fetchPrescriberProfile()).rejects.toThrow(
      "No se pudieron cargar los datos de la receta.",
    );
    expect(spy).toHaveBeenCalledWith("[prescriberService] read failed:", "42501");
  });
});

describe("savePrescriberProfile", () => {
  it("upserts the single row with trimmed text, digits-only cédulas and nulls for empty fields", async () => {
    await savePrescriberProfile(fields);

    const query = supabaseMock.queries("prescriber_profile")[0];
    expect(query.args("upsert")).toEqual([
      {
        full_name: "Dra. Carmen Torres",
        cedula_profesional: "1234567",
        especialidad: "Dermatología",
        cedula_especialidad: "7654321",
        institucion_titulo: "UANL",
        consultorio_domicilio: "Av. Constitución 100",
        telefono: null,
      },
      { onConflict: "singleton" },
    ]);
  });

  it("drops the specialty cédula when there is no specialty", async () => {
    await savePrescriberProfile({ ...fields, especialidad: " " });
    const [payload] = supabaseMock.queries("prescriber_profile")[0].args("upsert") as [
      Record<string, unknown>,
    ];
    expect(payload.especialidad).toBeNull();
    expect(payload.cedula_especialidad).toBeNull();
  });

  it("explains a refused value", async () => {
    quiet();
    supabaseMock.onFrom("prescriber_profile", { error: { message: "check", code: "23514" } });
    await expect(savePrescriberProfile(fields)).rejects.toThrow(/solo números/);
  });
});

describe("signature", () => {
  it("names every version uniquely, in the only form the storage policy accepts", () => {
    const names = new Set(Array.from({ length: 50 }, () => newSignatureObjectName()));
    expect(names.size).toBe(50);
    for (const name of names) expect(name).toMatch(SIGNATURE_OBJECT_PATTERN);
    expect(SIGNATURE_OBJECT_PATTERN.test("signature.png")).toBe(false);
    expect(SIGNATURE_OBJECT_PATTERN.test("x/signature-a.png")).toBe(false);
    expect(SIGNATURE_OBJECT_PATTERN.test("signature-a.jpg")).toBe(false);
  });

  it("uploads a NEW version (never overwrites) and points the profile to it", async () => {
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    const path = await uploadSignature(png);

    expect(path).toMatch(SIGNATURE_OBJECT_PATTERN);
    const bucket = supabaseMock.bucket(SIGNATURE_BUCKET);
    expect(bucket.upload).toHaveBeenCalledWith(path, png, {
      upsert: false,
      contentType: "image/png",
      cacheControl: "3600",
    });
    expect(supabaseMock.queries("prescriber_profile")[0].args("upsert")).toEqual([
      { signature_path: path },
      { onConflict: "singleton" },
    ]);
  });

  it("refuses a non-PNG or an oversized signature before uploading", async () => {
    await expect(
      uploadSignature(new Blob(["x"], { type: "image/jpeg" })),
    ).rejects.toThrow("La firma debe ser una imagen PNG.");
    await expect(
      uploadSignature(new Blob([new Uint8Array(SIGNATURE_MAX_BYTES + 1)], { type: "image/png" })),
    ).rejects.toThrow(/demasiado grande/);
    expect(supabaseMock.bucket(SIGNATURE_BUCKET).upload).not.toHaveBeenCalled();
  });

  it("does not record the path when the upload fails", async () => {
    quiet();
    supabaseMock
      .bucket(SIGNATURE_BUCKET)
      .upload.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(
      uploadSignature(new Blob(["x"], { type: "image/png" })),
    ).rejects.toThrow("No se pudo guardar la firma. Intenta de nuevo.");
    expect(supabaseMock.queries("prescriber_profile")).toHaveLength(0);
  });

  it("downloads one version with the session (no public URL)", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const bucket = supabaseMock.bucket(SIGNATURE_BUCKET);
    bucket.download.mockResolvedValue({ data: blob, error: null });

    expect(await downloadSignature("signature-abc123.png")).toBe(blob);
    expect(bucket.download).toHaveBeenCalledWith("signature-abc123.png");
    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it("never asks the bucket for a name outside the signature pattern", async () => {
    await expect(downloadSignature("../clinical_records/x.png")).rejects.toThrow(
      "No se pudo cargar la firma guardada.",
    );
    expect(supabaseMock.bucket(SIGNATURE_BUCKET).download).not.toHaveBeenCalled();
  });

  it("reports a failed download", async () => {
    quiet();
    supabaseMock
      .bucket(SIGNATURE_BUCKET)
      .download.mockResolvedValue({ data: null, error: { message: "not found" } });
    await expect(downloadSignature("signature-abc123.png")).rejects.toThrow(
      "No se pudo cargar la firma guardada.",
    );
  });
});

describe("issuePrescription", () => {
  const row = {
    prescription_id: "rx-1",
    folio: 123,
    issued_at: "2026-10-05T17:00:00+00:00",
    signature_path: "signature-abc123.png",
    prescriber: {
      full_name: "Dra. Carmen Torres",
      cedula_profesional: "1234567",
      especialidad: null,
      cedula_especialidad: null,
      institucion_titulo: "UANL",
      consultorio_domicilio: "Av. Constitución 100",
      telefono: null,
    },
  };

  it("returns the stored snapshot of the first issue", async () => {
    supabaseMock.onRpc("issue_prescription", { data: row });

    const issued = await issuePrescription("rx-1");

    expect(supabaseMock.lastRpc("issue_prescription")?.args).toEqual({ p_prescription_id: "rx-1" });
    expect(issued).toEqual({
      folio: 123,
      issuedAt: "2026-10-05T17:00:00+00:00",
      signaturePath: "signature-abc123.png",
      prescriber: {
        fullName: "Dra. Carmen Torres",
        cedulaProfesional: "1234567",
        especialidad: "",
        cedulaEspecialidad: "",
        institucionTitulo: "UANL",
        consultorioDomicilio: "Av. Constitución 100",
        telefono: "",
      },
    });
  });

  it("says when the prescriber data is incomplete", async () => {
    quiet();
    supabaseMock.onRpc("issue_prescription", {
      error: { message: "Faltan datos de la receta.", code: "P0001", hint: "prescriber_incomplete" },
    });
    await expect(issuePrescription("rx-1")).rejects.toBeInstanceOf(PrescriberIncompleteError);
  });

  it("passes the server's Spanish refusal through and hides technical errors", async () => {
    quiet();
    supabaseMock.onRpc("issue_prescription", {
      error: { message: "Solo se puede emitir la receta de una consulta finalizada.", code: "P0001" },
    });
    await expect(issuePrescription("rx-1")).rejects.toThrow(
      "Solo se puede emitir la receta de una consulta finalizada.",
    );

    supabaseMock.onRpc("issue_prescription", { error: { message: "boom", code: "XX000" } });
    await expect(issuePrescription("rx-1")).rejects.toThrow(
      "No se pudo emitir la receta. Intenta de nuevo.",
    );
  });

  it("refuses an answer without a valid folio", async () => {
    supabaseMock.onRpc("issue_prescription", { data: { ...row, folio: null } });
    await expect(issuePrescription("rx-1")).rejects.toThrow(/No se pudo emitir/);
  });
});

describe("logPrescriptionShared", () => {
  it("calls the audit RPC with the prescription and the channel only", async () => {
    await logPrescriptionShared("rx-1", "download");
    expect(supabaseMock.lastRpc("log_prescription_shared")?.args).toEqual({
      p_prescription_id: "rx-1",
      p_channel: "download",
    });
  });

  it("passes the server's Spanish refusal through", async () => {
    quiet();
    supabaseMock.onRpc("log_prescription_shared", {
      error: { message: "Solo se puede emitir la receta de una consulta finalizada.", code: "P0001" },
    });
    await expect(logPrescriptionShared("rx-1", "print")).rejects.toThrow(
      "Solo se puede emitir la receta de una consulta finalizada.",
    );
  });

  it("hides technical errors", async () => {
    quiet();
    supabaseMock.onRpc("log_prescription_shared", { error: { message: "boom", code: "XX000" } });
    await expect(logPrescriptionShared("rx-1", "print")).rejects.toThrow(/Bitácora/);
  });
});
