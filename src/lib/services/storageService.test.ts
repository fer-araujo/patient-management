import { describe, expect, it, vi } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import {
  getClinicalFileDownloadUrl,
  getPatientFiles,
  uploadPatientFile,
} from "./storageService";

const BUCKET = "clinical_records";

describe("getClinicalFileDownloadUrl", () => {
  it("requests a short-lived signed URL that downloads under the original name", async () => {
    const bucket = supabaseMock.bucket(BUCKET);
    bucket.createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example/file" },
      error: null,
    });

    await expect(
      getClinicalFileDownloadUrl("patient-1", "1727200000000_estudio.pdf", "estudio.pdf"),
    ).resolves.toBe("https://signed.example/file");

    expect(supabaseMock.client.storage.from).toHaveBeenCalledWith(BUCKET);
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(
      "patient-1/1727200000000_estudio.pdf",
      60,
      { download: "estudio.pdf" },
    );
  });

  it("throws a Spanish message when no URL comes back", async () => {
    supabaseMock.bucket(BUCKET).createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: "Object not found" },
    });

    await expect(getClinicalFileDownloadUrl("p", "s", "o")).rejects.toThrow(
      "No se pudo generar el enlace de descarga.",
    );
  });
});

describe("uploadPatientFile", () => {
  const pdf = () => new File(["%PDF"], "mi estudio (1).pdf", { type: "application/pdf" });

  it("rejects an invalid file before touching Storage", async () => {
    const exe = new File(["MZ"], "virus.exe", { type: "application/x-msdownload" });

    await expect(uploadPatientFile("patient-1", exe, "patient")).rejects.toThrow(
      'El archivo "virus.exe" no se puede subir.',
    );
    expect(supabaseMock.client.storage.from).not.toHaveBeenCalled();
  });

  it("stores a patient upload in their folder and registers it through the RPC", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1727200000000);
    const file = pdf();

    await uploadPatientFile("patient-1", file, "patient");

    const bucket = supabaseMock.bucket(BUCKET);
    expect(bucket.upload).toHaveBeenCalledWith(
      "patient-1/1727200000000_mi_estudio__1_.pdf",
      file,
      { contentType: "application/pdf" },
    );
    expect(supabaseMock.lastRpc("register_my_upload")?.args).toEqual({
      p_object_name: "patient-1/1727200000000_mi_estudio__1_.pdf",
      p_file_name: "mi estudio (1).pdf",
    });
    expect(supabaseMock.queries("patient_files")).toHaveLength(0);
  });

  it("registers a doctor upload directly in patient_files", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1727200000000);

    await uploadPatientFile("patient-1", pdf(), "doctor");

    expect(supabaseMock.rpcCalls()).toHaveLength(0);
    expect(supabaseMock.queries("patient_files")[0].args("insert")).toEqual([
      {
        patient_id: "patient-1",
        file_url: "patient-1/1727200000000_mi_estudio__1_.pdf",
        file_name: "mi estudio (1).pdf",
        file_type: "application/pdf",
        uploaded_by: "doctor",
      },
    ]);
  });

  it("surfaces a Storage failure and does not register anything", async () => {
    supabaseMock.bucket(BUCKET).upload.mockResolvedValueOnce({
      data: null,
      error: { message: "Payload too large" },
    });

    await expect(uploadPatientFile("patient-1", pdf(), "patient")).rejects.toThrow(
      "Error subiendo archivo: Payload too large",
    );
    expect(supabaseMock.rpcCalls()).toHaveLength(0);
  });
});

describe("getPatientFiles", () => {
  it("lists files newest first with their original names and signed URLs", async () => {
    const bucket = supabaseMock.bucket(BUCKET);
    bucket.list.mockResolvedValueOnce({
      data: [
        {
          name: "1000_old_scan.pdf",
          created_at: "2026-09-01T16:00:00Z",
          metadata: { mimetype: "application/pdf" },
        },
        {
          name: "2000_foto.png",
          created_at: "2026-09-10T16:00:00Z",
          metadata: { mimetype: "image/png" },
        },
      ],
      error: null,
    });
    bucket.createSignedUrl.mockImplementation(async (path: string) => ({
      data: { signedUrl: `https://signed/${path}` },
      error: null,
    }));

    const files = await getPatientFiles("patient-1");

    expect(bucket.list).toHaveBeenCalledWith("patient-1", {
      limit: 100,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });
    expect(files.map((f) => [f.originalName, f.isImage])).toEqual([
      ["foto.png", true],
      ["old_scan.pdf", false],
    ]);
    expect(files[0].url).toBe("https://signed/patient-1/2000_foto.png");
  });

  it("pages past Storage's 100-object default so no file is left out", async () => {
    const bucket = supabaseMock.bucket(BUCKET);
    const named = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        name: `${from + i}_f${from + i}.pdf`,
        created_at: "2026-09-01T16:00:00Z",
        metadata: { mimetype: "application/pdf" },
      }));
    bucket.list
      .mockResolvedValueOnce({ data: named(0, 100), error: null })
      .mockResolvedValueOnce({ data: named(100, 5), error: null });
    bucket.createSignedUrl.mockImplementation(async (path: string) => ({
      data: { signedUrl: `https://signed/${path}` },
      error: null,
    }));

    const files = await getPatientFiles("patient-1");

    expect(files).toHaveLength(105);
    expect(bucket.list).toHaveBeenCalledTimes(2);
    expect(bucket.list.mock.calls[1][1]).toMatchObject({ limit: 100, offset: 100 });
  });

  it("returns an empty list for a patient without files", async () => {
    supabaseMock.bucket(BUCKET).list.mockResolvedValueOnce({ data: [], error: null });
    await expect(getPatientFiles("patient-1")).resolves.toEqual([]);
  });
});
