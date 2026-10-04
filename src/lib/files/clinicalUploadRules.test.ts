import { describe, expect, it } from "vitest";
import {
  CLINICAL_UPLOAD_MAX_BYTES,
  CLINICAL_UPLOAD_RULES_TEXT,
  resolveClinicalMimeType,
  validateClinicalFile,
} from "./clinicalUploadRules";

/** A File whose reported size is `size` without allocating that many bytes. */
const fakeFile = (name: string, type: string, size = 1024): File => {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("validateClinicalFile", () => {
  it.each([
    ["estudio.pdf", "application/pdf"],
    ["foto.jpg", "image/jpeg"],
    ["foto.jpeg", "image/jpeg"],
    ["captura.png", "image/png"],
    ["iphone.heic", "image/heic"],
  ])("accepts %s (%s)", (name, type) => {
    expect(validateClinicalFile(fakeFile(name, type))).toBeNull();
  });

  it("accepts a HEIC photo reported with an empty MIME type (extension fallback)", () => {
    expect(validateClinicalFile(fakeFile("IMG_0001.HEIC", ""))).toBeNull();
  });

  it("accepts a file of exactly 10 MB", () => {
    expect(CLINICAL_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(
      validateClinicalFile(fakeFile("grande.pdf", "application/pdf", CLINICAL_UPLOAD_MAX_BYTES)),
    ).toBeNull();
  });

  it.each([
    ["programa.exe", "application/x-msdownload"],
    ["notas.txt", "text/plain"],
    ["animacion.gif", "image/gif"],
    ["documento.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["sin_extension", ""],
  ])("rejects %s with the Spanish formats message", (name, type) => {
    const message = validateClinicalFile(fakeFile(name, type));
    expect(message).toBe(`El archivo "${name}" no se puede subir. ${CLINICAL_UPLOAD_RULES_TEXT}`);
    expect(message).toContain("Formatos permitidos: PDF, JPG, PNG o HEIC");
  });

  it("rejects a file over 10 MB and says how big it is", () => {
    const message = validateClinicalFile(
      fakeFile("resonancia.pdf", "application/pdf", CLINICAL_UPLOAD_MAX_BYTES + 1),
    );
    expect(message).toBe(
      'El archivo "resonancia.pdf" pesa 10.0 MB. El máximo permitido es 10 MB.',
    );
  });

  it("rejects an empty file", () => {
    expect(validateClinicalFile(fakeFile("vacio.png", "image/png", 0))).toBe(
      'El archivo "vacio.png" está vacío.',
    );
  });
});

describe("resolveClinicalMimeType", () => {
  it("trusts an allowed browser MIME type", () => {
    expect(resolveClinicalMimeType(fakeFile("scan.bin", "application/pdf"))).toBe(
      "application/pdf",
    );
  });

  it("falls back to the extension, case-insensitively", () => {
    expect(resolveClinicalMimeType(fakeFile("FOTO.JPG", ""))).toBe("image/jpeg");
    expect(resolveClinicalMimeType(fakeFile("foto.heic", "application/octet-stream"))).toBe(
      "image/heic",
    );
  });

  it("returns null for anything it cannot classify as allowed", () => {
    expect(resolveClinicalMimeType(fakeFile("script.js", "text/javascript"))).toBeNull();
  });
});
