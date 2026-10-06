import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
  type PDFFont,
  type PDFObject,
} from "pdf-lib";
import type { PrescriberProfileFields } from "../../../lib/services/prescriberService";
import { TEST_SIGNATURE_PNG } from "../../../test/signaturePng";
import { withBrowserTimeZone } from "../../../test/browserTimeZone";
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PRESCRIPTION_FOOTER,
  PrescriptionPdfError,
  buildPrescriptionPdf,
  formatFolio,
  formatPrescriptionDate,
  makeSanitizer,
  type PrescriptionPdfInput,
} from "./buildPrescriptionPdf";

/** Fictitious prescriber data of an issue snapshot. */
const prescriber: PrescriberProfileFields = {
  fullName: "Dra. Ana Lucía Prueba Ejemplo",
  cedulaProfesional: "1234567",
  especialidad: "Medicina Familiar",
  cedulaEspecialidad: "7654321",
  institucionTitulo: "U.E.P.",
  consultorioDomicilio: "Calle Ejemplo #123 Colonia Centro, Ciudad, N.L.",
  telefono: "8100 00 00 00",
};

const input = (over: Partial<PrescriptionPdfInput> = {}): PrescriptionPdfInput => ({
  prescriber,
  signaturePng: TEST_SIGNATURE_PNG,
  folio: 123,
  patient: { name: "Paciente Ficticia Núñez", dob: "1958-01-10", sex: "Femenino" },
  prescription: {
    finalizedAt: "2026-10-05T17:30:00Z",
    medications: [
      {
        nombre: "Ibuprofeno",
        presentacion: "Tabletas 400 mg",
        dosis: "1 tableta",
        via: "Oral",
        frecuencia: "Cada 8 h",
        duracion: "5 días",
        indicaciones: "¿Dolor? Tomar con alimentos. ¡No exceder!",
      },
      // Written before migration 25: no structured fields.
      { nombre: "Hidroquinona", dosis: "4 %", indicaciones: "Aplicar de noche" },
    ],
  },
  ...over,
});

const resolve = (doc: PDFDocument, obj: PDFObject | undefined) =>
  obj instanceof PDFRef ? doc.context.lookup(obj) : obj;

/** WinAnsi bytes 0x80-0x9F that differ from Latin-1 (the ones used here). */
const WIN_ANSI: Record<number, string> = { 0x95: "•", 0x96: "–", 0x97: "—" };

/** Decodes a WinAnsi hex string as pdf-lib writes it for standard fonts. */
const decodeHex = (hex: string): string => {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    out += WIN_ANSI[byte] ?? String.fromCharCode(byte);
  }
  return out;
};

interface DrawnText {
  page: number;
  text: string;
  font: string;
  size: number;
  x: number;
  y: number;
}

/** Every text drawn on every page, in drawing order, with font, size and position. */
const pdfTexts = async (bytes: Uint8Array): Promise<DrawnText[]> => {
  const doc = await PDFDocument.load(bytes);
  const out: DrawnText[] = [];
  doc.getPages().forEach((page, index) => {
    const contents = resolve(doc, page.node.get(PDFName.of("Contents")));
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => resolve(doc, ref))
        : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const data = decodePDFRawStream(stream).decode();
      const source = Array.from(data, (b) => String.fromCharCode(b)).join("");
      const pattern =
        /\/(\S+)\s+([\d.]+)\s+Tf[\s\S]*?([-\d.]+)\s+([-\d.]+)\s+Tm\s*<([0-9A-Fa-f]*)>\s*Tj/g;
      for (const m of source.matchAll(pattern)) {
        out.push({
          page: index,
          font: m[1],
          size: Number(m[2]),
          x: Number(m[3]),
          y: Number(m[4]),
          text: decodeHex(m[5]),
        });
      }
    }
  });
  return out;
};

const pdfLines = async (bytes: Uint8Array): Promise<string[]> =>
  (await pdfTexts(bytes)).map((t) => t.text);

/** Images drawn on each page (the signature), counted per page. */
const imagesPerPage = async (bytes: Uint8Array): Promise<number[]> => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return 0;
    return xobjects.keys().filter((key) => {
      const obj = resolve(doc, xobjects.get(key));
      return (
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
      );
    }).length;
  });
};

/** Real Helvetica metrics, to check that every text fits its line. */
const fontsForWidth = async () => {
  const doc = await PDFDocument.create();
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
};

const expectInsideMargins = async (texts: DrawnText[]) => {
  const { regular, bold } = await fontsForWidth();
  for (const t of texts) {
    const font: PDFFont = t.font.includes("Bold") ? bold : regular;
    const width = font.widthOfTextAtSize(t.text, t.size);
    expect(t.x, t.text).toBeGreaterThanOrEqual(36 - 0.5);
    expect(t.x + width, t.text).toBeLessThanOrEqual(PAGE_WIDTH - 36 + 0.5);
  }
};

const DOCTOR = "Dra. Ana Lucía Prueba Ejemplo";
const CREDENTIALS = "U.E.P. CED. PROF: 1234567 CED. ESP. 7654321";
const CONTACT = "Cel: 8100 00 00 00 • Calle Ejemplo #123 Colonia Centro, Ciudad, N.L.";

describe("buildPrescriptionPdf", () => {
  it("is a half-letter landscape page (8.5 x 5.5 in)", async () => {
    const doc = await PDFDocument.load(await buildPrescriptionPdf(input()));
    expect(PAGE_WIDTH).toBe(612);
    expect(PAGE_HEIGHT).toBe(396);
    for (const page of doc.getPages()) {
      expect(page.getSize()).toEqual({ width: 612, height: 396 });
    }
  });

  it("follows the paper form: header, patient, medications, signature, footer", async () => {
    const bytes = await buildPrescriptionPdf(input());
    const texts = await pdfTexts(bytes);
    const lines = texts.map((t) => t.text);
    const at = (text: string) => {
      const index = lines.indexOf(text);
      expect(index, `"${text}" is drawn`).toBeGreaterThanOrEqual(0);
      return index;
    };

    const order = [
      DOCTOR,
      "Medicina Familiar",
      CREDENTIALS,
      "Nombre del Paciente: ",
      "Paciente Ficticia Núñez",
      "Edad: ",
      "68 años",
      "Fecha: ",
      formatPrescriptionDate("2026-10-05T17:30:00Z"),
      "Folio 000123",
      CONTACT,
      PRESCRIPTION_FOOTER,
      "1. Ibuprofeno - Tabletas 400 mg",
      "Dosis: 1 tableta   Vía: Oral   Frecuencia: Cada 8 h   Duración: 5 días",
      "Indicaciones: ¿Dolor? Tomar con alimentos. ¡No exceder!",
      "2. Hidroquinona",
      "Dosis: 4 %",
      "Indicaciones: Aplicar de noche",
      "Céd. Prof. 1234567",
    ];
    const positions = order.map(at);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // Header centered and top-down; the name large and regular, line 3 bold.
    const name = texts[at(DOCTOR)];
    const specialty = texts[at("Medicina Familiar")];
    const credentials = texts[at(CREDENTIALS)];
    expect(name.font).not.toContain("Bold");
    expect(name.size).toBeGreaterThan(specialty.size);
    expect(specialty.size).toBeGreaterThan(credentials.size);
    expect(credentials.font).toContain("Bold");
    expect(name.y).toBeGreaterThan(specialty.y);
    expect(specialty.y).toBeGreaterThan(credentials.y);
    const { regular } = await fontsForWidth();
    const center = name.x + regular.widthOfTextAtSize(name.text, name.size) / 2;
    expect(center).toBeCloseTo(PAGE_WIDTH / 2, 0);

    // Footer: contact bold and centered above the gray note, both at the bottom.
    const contact = texts[at(CONTACT)];
    const note = texts[at(PRESCRIPTION_FOOTER)];
    expect(contact.font).toContain("Bold");
    expect(contact.y).toBeGreaterThan(note.y);
    expect(note.y).toBeLessThan(40);
    // The signature's printed name sits above the footer, at the right.
    const signed = texts.filter((t) => t.text === DOCTOR).at(-1)!;
    expect(signed.y).toBeGreaterThan(contact.y);
    expect(signed.x).toBeGreaterThan(PAGE_WIDTH / 2);
    // Readable body.
    expect(texts[at("Dosis: 4 %")].size).toBeGreaterThanOrEqual(10);

    await expectInsideMargins(texts);
  });

  it("omits the specialty cédula (and the specialty line) when there is none", async () => {
    const lines = await pdfLines(
      await buildPrescriptionPdf(
        input({ prescriber: { ...prescriber, especialidad: "", cedulaEspecialidad: "" } }),
      ),
    );
    expect(lines).toContain("U.E.P. CED. PROF: 1234567");
    expect(lines.join("\n")).not.toContain("CED. ESP.");
    expect(lines).not.toContain("Medicina Familiar");
  });

  it("writes the institution in capitals with one period, keeping accents", async () => {
    const lines = await pdfLines(
      await buildPrescriptionPdf(
        input({ prescriber: { ...prescriber, institucionTitulo: "Universidad Autónoma." } }),
      ),
    );
    expect(lines).toContain("UNIVERSIDAD AUTÓNOMA. CED. PROF: 1234567 CED. ESP. 7654321");
  });

  it("separates phone and address with a bullet WinAnsi can draw", async () => {
    const lines = await pdfLines(
      await buildPrescriptionPdf(
        input({
          prescriber: { ...prescriber, consultorioDomicilio: "Local 4 ● Plaza Ñandú, Ciudad" },
        }),
      ),
    );
    // "●" is not in WinAnsi: drawn as "•", both as separator and in the address.
    expect(lines).toContain("Cel: 8100 00 00 00 • Local 4 • Plaza Ñandú, Ciudad");
    expect(lines.join("\n")).not.toContain("●");
  });

  it("without a phone the footer has the address only", async () => {
    const lines = await pdfLines(
      await buildPrescriptionPdf(input({ prescriber: { ...prescriber, telefono: "" } })),
    );
    expect(lines).toContain("Calle Ejemplo #123 Colonia Centro, Ciudad, N.L.");
    expect(lines.join("\n")).not.toContain("Cel:");
  });

  it("falls back to '-' when the font cannot draw the bullet either", () => {
    const withoutBullet = makeSanitizer({
      getCharacterSet: () => Array.from({ length: 0xff - 0x20 }, (_, i) => i + 0x20),
    });
    expect(withoutBullet("A ● B • C", 20)).toBe("A - B - C");
    const helveticaLike = makeSanitizer({
      getCharacterSet: () => [...Array.from({ length: 0xff - 0x20 }, (_, i) => i + 0x20), 0x2022],
    });
    expect(helveticaLike("A ● B", 20)).toBe("A • B");
  });

  it("shrinks or wraps a long credentials line and footer to fit the width", async () => {
    const texts = await pdfTexts(
      await buildPrescriptionPdf(
        input({
          prescriber: {
            ...prescriber,
            fullName: "Dra. " + "Nombre Muy Largo De Prueba ".repeat(4).trim(),
            institucionTitulo:
              "Universidad Ficticia de Estudios Superiores en Ciencias de la Salud y Medicina Integral del Noreste",
            consultorioDomicilio:
              "Avenida Ejemplo Número 1234 Interior 56, Colonia Fraccionamiento de Prueba, Municipio Ejemplo, Estado de Ejemplo, C.P. 00000",
          },
        }),
      ),
    );
    await expectInsideMargins(texts);
    const firstPage = texts.filter((t) => t.page === 0).map((t) => t.text).join("\n");
    expect(firstPage).toContain("CED. PROF: 1234567");
    expect(firstPage).toContain("C.P. 00000");
    expect(firstPage).toContain(PRESCRIPTION_FOOTER);
  });

  it("embeds the signature image once", async () => {
    expect((await imagesPerPage(await buildPrescriptionPdf(input()))).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("dates it on the clinic calendar and names it by folio only", async () => {
    // 01:00 UTC on Oct 6 is still Oct 5 in Monterrey.
    expect(formatPrescriptionDate("2026-10-06T01:00:00Z")).toBe("5 de octubre de 2026");
    expect(formatFolio(123)).toBe("000123");
    expect(formatFolio(1)).toBe("000001");
    // Never cut once folios pass six digits.
    expect(formatFolio(1234567)).toBe("1234567");

    const doc = await PDFDocument.load(await buildPrescriptionPdf(input()));
    expect(doc.getTitle()).toBe("Receta 000123");
    expect(doc.getTitle()).not.toContain("Paciente");
  });

  it("computes the age on the clinic's calendar day, the same day it prints", async () => {
    // 01:00 UTC on Oct 6 is Oct 5 in Monterrey: the patient born on Oct 6
    // has not had her birthday yet on the printed date.
    const atBoundary = input({
      patient: { name: "Paciente", dob: "1958-10-06", sex: "Femenino" },
      prescription: { ...input().prescription, finalizedAt: "2026-10-06T01:00:00Z" },
    });
    for (const zone of ["America/Monterrey", "UTC", "Asia/Tokyo"]) {
      await withBrowserTimeZone(zone, async () => {
        const lines = await pdfLines(await buildPrescriptionPdf(atBoundary));
        expect(lines).toContain("5 de octubre de 2026");
        expect(lines).toContain("67 años");
      });
    }

    // Her birthday on the printed date counts.
    const birthday = input({
      patient: { name: "Paciente", dob: "1958-10-05", sex: "Femenino" },
      prescription: { ...input().prescription, finalizedAt: "2026-10-06T01:00:00Z" },
    });
    await withBrowserTimeZone("UTC", async () => {
      expect(await pdfLines(await buildPrescriptionPdf(birthday))).toContain("68 años");
    });
  });

  it("replaces characters the standard font cannot draw instead of failing", async () => {
    const lines = await pdfLines(
      await buildPrescriptionPdf(
        input({
          patient: { name: "Zoë 😀 Pérez\nTab", dob: null, sex: null },
          prescription: {
            ...input().prescription,
            medications: [
              { nombre: "Vitamina B12 1000 μg", dosis: "≥ 1 ampolleta", via: "Intramuscular", frecuencia: "Cada mes", indicaciones: "" },
            ],
          },
        }),
      ),
    );
    expect(lines).toContain("Zoë ? Pérez Tab");
    expect(lines).toContain("1. Vitamina B12 1000 µg");
    expect(lines.join("\n")).toContain("Dosis: >= 1 ampolleta");
    expect(lines).toContain("Sin registrar");
  });

  it("continues on more half-letter pages, repeating header, patient and footer", async () => {
    const long = "palabra ".repeat(200);
    const bytes = await buildPrescriptionPdf(
      input({
        prescription: {
          ...input().prescription,
          medications: Array.from({ length: 12 }, (_, i) => ({
            nombre: `Medicamento ${i + 1}`,
            dosis: "1",
            via: "Oral",
            frecuencia: "Cada 8 h",
            indicaciones: long,
          })),
        },
      }),
    );
    const doc = await PDFDocument.load(bytes);
    const pageCount = doc.getPageCount();
    expect(pageCount).toBeGreaterThan(1);
    for (const page of doc.getPages()) {
      expect(page.getSize()).toEqual({ width: 612, height: 396 });
    }

    const texts = await pdfTexts(bytes);
    for (let p = 0; p < pageCount; p += 1) {
      const onPage = texts.filter((t) => t.page === p).map((t) => t.text);
      expect(onPage, `page ${p + 1}`).toContain(DOCTOR);
      expect(onPage).toContain(CREDENTIALS);
      expect(onPage).toContain("Nombre del Paciente: ");
      expect(onPage).toContain("Folio 000123");
      expect(onPage).toContain(CONTACT);
      expect(onPage).toContain(PRESCRIPTION_FOOTER);
      expect(onPage).toContain(`Página ${p + 1} de ${pageCount}`);
    }

    const lines = texts.map((t) => t.text);
    // Indications are capped at 500 characters.
    const indicationText = lines.filter((l) => l.includes("palabra")).join(" ");
    expect(indicationText.length).toBeLessThan(12 * 560);
    expect(lines).toContain("12. Medicamento 12");
    // One signature, on the last page.
    const perPage = await imagesPerPage(bytes);
    expect(perPage.at(-1)).toBe(1);
    expect(perPage.reduce((a, b) => a + b, 0)).toBe(1);
    // The body never runs into the footer.
    const footerTop = Math.max(...texts.filter((t) => t.text === CONTACT).map((t) => t.y));
    for (const t of texts.filter((x) => x.text.includes("palabra"))) {
      expect(t.y).toBeGreaterThan(footerTop + 8);
    }
    await expectInsideMargins(texts);
  });

  it("a one-page prescription has no page numbers", async () => {
    const lines = await pdfLines(await buildPrescriptionPdf(input()));
    expect(lines.join("\n")).not.toMatch(/Página \d+ de/);
  });

  it("refuses a prescription that is not finalized", async () => {
    await expect(
      buildPrescriptionPdf(
        input({ prescription: { ...input().prescription, finalizedAt: null } }),
      ),
    ).rejects.toThrow("Solo se puede emitir la receta de una consulta finalizada.");
  });

  it("refuses an incomplete prescriber snapshot and says what is missing", async () => {
    const error = await buildPrescriptionPdf(
      input({
        prescriber: { ...prescriber, cedulaProfesional: "", consultorioDomicilio: " " },
        signaturePng: new Uint8Array(),
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrescriptionPdfError);
    expect((error as PrescriptionPdfError).missing).toEqual([
      "Cédula profesional",
      "Domicilio del consultorio",
      "Firma",
    ]);
  });

  it("refuses a prescription without a folio", async () => {
    await expect(buildPrescriptionPdf(input({ folio: 0 }))).rejects.toThrow(
      "La receta no tiene folio.",
    );
  });

  it("refuses an unreadable signature and an empty prescription", async () => {
    await expect(
      buildPrescriptionPdf(input({ signaturePng: new Uint8Array([1, 2, 3]) })),
    ).rejects.toThrow(/firma guardada/);
    await expect(
      buildPrescriptionPdf(
        input({ prescription: { ...input().prescription, medications: [] } }),
      ),
    ).rejects.toThrow("La receta no tiene medicamentos.");
  });
});
