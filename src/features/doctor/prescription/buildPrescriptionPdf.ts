import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { MedicationItem } from "../../../lib/services/soapService";
import type { PrescriberProfileFields } from "../../../lib/services/prescriberService";
import { getZonedParts } from "../../../lib/clinicTime";
import { ageFromDob } from "../utils/patientIdentity";
import { missingPrintedItems } from "./prescriberProfile";
import { MAX_MEDICATIONS } from "./medication";
import {
  PRESCRIPTION_FOOTER,
  PrescriptionPdfError,
  formatFolio,
  formatPrescriptionDate,
} from "./prescriptionPdfShared";

export {
  PRESCRIPTION_FOOTER,
  PrescriptionPdfError,
  formatFolio,
  formatPrescriptionDate,
};

/**
 * Builds the official prescription PDF (RIS art. 29) in the doctor's
 * browser. Pure: no network, no storage; the caller passes the frozen
 * prescription and the ISSUE SNAPSHOT (issue_prescription): the prescriber
 * data, the signature version's PNG bytes and the folio as they were at the
 * first issue, so a later edit of her data never changes an issued PDF.
 *
 * Fonts are pdf-lib's StandardFonts (Helvetica, WinAnsi encoding): nothing is
 * fetched or embedded from outside. WinAnsi covers Spanish (ñ, á, é, í, ó,
 * ú, ü, ¿, ¡); any other character is transliterated or replaced, so user
 * text can never break the document.
 */

export interface PrescriptionPdfInput {
  /** The printed prescriber data of the issue snapshot. */
  prescriber: PrescriberProfileFields;
  /** PNG bytes of the signature version of the issue snapshot. */
  signaturePng: Uint8Array;
  /** Folio the database assigned at the first issue. */
  folio: number;
  patient: {
    name: string;
    dob?: string | null;
    sex?: string | null;
  };
  prescription: {
    finalizedAt: string | null;
    medications: MedicationItem[];
  };
}

// Half-letter landscape (8.5 x 5.5 in), like the doctor's paper pad.
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 396;
const MARGIN_X = 36;
const MARGIN_TOP = 26;
const MARGIN_BOTTOM = 20;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const BODY_SIZE = 10;
const SIGNATURE_WIDTH = 170;

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.35, 0.39, 0.45);
/** The paper's thick rules: dark navy, close to brand-dark. */
const BAND = rgb(0.11, 0.14, 0.22);
const BAND_THICKNESS = 2.5;

const TEXT_LIMITS = {
  short: 120,
  long: 300,
  indications: 500,
};

/** Common look-alikes outside WinAnsi. */
const REPLACEMENTS: Record<string, string> = {
  "−": "-", // minus sign
  "‐": "-",
  "‑": "-",
  "≤": "<=",
  "≥": ">=",
  "●": "•", // black circle -> WinAnsi bullet
  "◦": "•",
  "▪": "•",
  "μ": "µ", // Greek mu -> micro sign
  " ": " ",
};

/** Used when even the replacement cannot be drawn by the font. */
const LAST_RESORT: Record<string, string> = {
  "●": "-",
  "•": "-",
  "◦": "-",
  "▪": "-",
};

/**
 * Text the font can draw: control characters become spaces, every other
 * unsupported character is replaced by its unaccented form or "?", and the
 * length is capped.
 */
export const makeSanitizer = (font: Pick<PDFFont, "getCharacterSet">) => {
  const supported = new Set(font.getCharacterSet());
  return (value: string | null | undefined, max: number): string => {
    const clean = Array.from((value ?? "").normalize("NFC"), (c) => {
      const code = c.codePointAt(0)!;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : c;
    })
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
    let out = "";
    for (const char of clean) {
      const replaced = REPLACEMENTS[char] ?? char;
      if ([...replaced].every((c) => supported.has(c.codePointAt(0)!))) {
        out += replaced;
        continue;
      }
      const lastResort = LAST_RESORT[char];
      if (lastResort && [...lastResort].every((c) => supported.has(c.codePointAt(0)!))) {
        out += lastResort;
        continue;
      }
      const plain = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out +=
        plain && [...plain].every((c) => supported.has(c.codePointAt(0)!))
          ? plain
          : "?";
    }
    return out;
  };
};

/** Splits text into lines no wider than `width`; long words are broken. */
const wrapText = (text: string, font: PDFFont, size: number, width: number): string[] => {
  if (!text) return [];
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (!fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
};

/**
 * The patient's age on the clinic's calendar day of `at` (the printed date),
 * whatever zone the browser is in.
 */
const describeAge = (dob: string | null | undefined, at: Date): string => {
  const day = getZonedParts(at);
  const age = ageFromDob(dob, new Date(day.year, day.month - 1, day.day));
  if (age === null) return "Sin registrar";
  return `${age} ${age === 1 ? "año" : "años"}`;
};

export const buildPrescriptionPdf = async (
  input: PrescriptionPdfInput,
): Promise<Uint8Array> => {
  const { prescriber, prescription, patient } = input;

  if (!prescription.finalizedAt) {
    throw new PrescriptionPdfError(
      "Solo se puede emitir la receta de una consulta finalizada.",
    );
  }
  const missing = [
    ...missingPrintedItems(prescriber),
    ...(input.signaturePng && input.signaturePng.length > 0 ? [] : ["Firma"]),
  ];
  if (missing.length > 0) {
    throw new PrescriptionPdfError(
      `Faltan datos de la receta: ${missing.join(", ")}.`,
      missing,
    );
  }
  if (!Number.isSafeInteger(input.folio) || input.folio <= 0) {
    throw new PrescriptionPdfError("La receta no tiene folio.");
  }
  const medications = prescription.medications.filter((m) => m && m.nombre?.trim());
  if (medications.length === 0) {
    throw new PrescriptionPdfError("La receta no tiene medicamentos.");
  }
  if (medications.length > MAX_MEDICATIONS) {
    throw new PrescriptionPdfError(
      `La receta tiene más de ${MAX_MEDICATIONS} medicamentos.`,
    );
  }

  const doc = await PDFDocument.create();
  const folio = formatFolio(input.folio);
  const issuedAt = new Date(prescription.finalizedAt);
  doc.setTitle(`Receta ${folio}`);
  doc.setSubject("Receta médica");
  doc.setLanguage("es-MX");
  doc.setCreator("Expediente clínico");
  doc.setCreationDate(issuedAt);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = makeSanitizer(regular);

  let signature: PDFImage;
  try {
    signature = await doc.embedPng(input.signaturePng);
  } catch {
    throw new PrescriptionPdfError(
      "No se pudo leer la firma guardada. Dibújala de nuevo en «Datos de la receta».",
      ["Firma"],
    );
  }

  // --- Texts of the paper form (all from the issue snapshot) -----------------
  const doctorName = clean(prescriber.fullName, TEXT_LIMITS.short);
  const especialidad = clean(prescriber.especialidad, TEXT_LIMITS.short);
  const cedula = clean(prescriber.cedulaProfesional, 12);
  const cedulaEsp = especialidad ? clean(prescriber.cedulaEspecialidad, 12) : "";
  const institucion = clean(prescriber.institucionTitulo, TEXT_LIMITS.long).replace(/\.+$/, "");
  const credentials = [
    `${institucion}.`,
    `CED. PROF: ${cedula}`,
    cedulaEsp ? `CED. ESP. ${cedulaEsp}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleUpperCase("es-MX");
  const phone = clean(prescriber.telefono, 20);
  const address = clean(prescriber.consultorioDomicilio, TEXT_LIMITS.long);
  const separator = clean("●", 1);
  const contact = phone ? `Cel: ${phone} ${separator} ${address}` : address;
  const patientName = clean(patient.name, TEXT_LIMITS.short);
  const ageText = clean(describeAge(patient.dob, issuedAt), 40);
  const dateText = clean(formatPrescriptionDate(prescription.finalizedAt), 60);

  /** One line at the largest size from `max` to `min` that fits, else wrapped at `min`. */
  const fit = (value: string, font: PDFFont, max: number, min: number) => {
    for (let size = max; size >= min; size -= 0.5) {
      if (font.widthOfTextAtSize(value, size) <= CONTENT_WIDTH) return { size, lines: [value] };
    }
    return { size: min, lines: wrapText(value, font, min, CONTENT_WIDTH) };
  };
  const nameFit = fit(doctorName, regular, 17, 11);
  const specialtyFit = especialidad ? fit(especialidad, regular, 12, 9) : null;
  const credentialsFit = fit(credentials, bold, 9.5, 7);
  const contactFit = fit(contact, bold, 9.5, 7);

  // Footer, bottom up: note, contact lines, thick rule.
  const NOTE_SIZE = 7;
  const noteY = MARGIN_BOTTOM;
  const contactLineHeight = contactFit.size + 2.5;
  const contactBottomY = noteY + NOTE_SIZE + 6;
  const footerRuleY = contactBottomY + contactLineHeight * contactFit.lines.length + 2;
  /** Lowest baseline the body may use. */
  const bodyBottom = footerRuleY + 10;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const draw = (
    value: string,
    x: number,
    size: number,
    font: PDFFont = regular,
    color = INK,
  ) => page.drawText(value, { x, y, size, font, color });

  const drawCentered = (value: string, size: number, font: PDFFont, color = INK) =>
    draw(value, (PAGE_WIDTH - font.widthOfTextAtSize(value, size)) / 2, size, font, color);

  const band = (at: number) =>
    page.drawLine({
      start: { x: MARGIN_X, y: at },
      end: { x: PAGE_WIDTH - MARGIN_X, y: at },
      thickness: BAND_THICKNESS,
      color: BAND,
    });

  const underline = (x1: number, x2: number) =>
    page.drawLine({
      start: { x: x1, y: y - 2.5 },
      end: { x: x2, y: y - 2.5 },
      thickness: 0.6,
      color: INK,
    });

  /** "Label: value" with a thin form line under the value, up to `end`. */
  const field = (label: string, value: string, x: number, end: number) => {
    const labelText = `${label}: `;
    draw(labelText, x, BODY_SIZE, regular);
    const valueX = x + regular.widthOfTextAtSize(labelText, BODY_SIZE);
    const room = Math.max(end - valueX - 4, 20);
    // Never wider than its line: shrink a long value.
    let size = 11;
    while (size > 7 && regular.widthOfTextAtSize(value, size) > room) size -= 0.5;
    draw(value, valueX + 2, size, regular);
    underline(valueX, end);
  };

  /** Header, patient block and footer: the same on every page. */
  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);

    // Header, centered.
    y = PAGE_HEIGHT - MARGIN_TOP - nameFit.size;
    for (const line of nameFit.lines) {
      drawCentered(line, nameFit.size, regular);
      y -= nameFit.size + 3;
    }
    if (specialtyFit) {
      y -= 1;
      for (const line of specialtyFit.lines) {
        drawCentered(line, specialtyFit.size, regular);
        y -= specialtyFit.size + 3;
      }
    }
    y -= 1;
    for (const line of credentialsFit.lines) {
      drawCentered(line, credentialsFit.size, bold);
      y -= credentialsFit.size + 2.5;
    }
    y -= 2;
    band(y);

    // Patient block.
    y -= 20;
    field("Nombre del Paciente", patientName, MARGIN_X, PAGE_WIDTH - MARGIN_X);
    y -= 20;
    field("Edad", ageText, MARGIN_X, MARGIN_X + 140);
    field("Fecha", dateText, MARGIN_X + 160, MARGIN_X + 400);
    const folioText = `Folio ${folio}`;
    draw(
      folioText,
      PAGE_WIDTH - MARGIN_X - regular.widthOfTextAtSize(folioText, 8),
      8,
      regular,
      MUTED,
    );
    y -= 22;

    // Footer.
    page.drawLine({
      start: { x: MARGIN_X, y: footerRuleY },
      end: { x: PAGE_WIDTH - MARGIN_X, y: footerRuleY },
      thickness: BAND_THICKNESS,
      color: BAND,
    });
    contactFit.lines.forEach((line, i) => {
      page.drawText(line, {
        x: (PAGE_WIDTH - bold.widthOfTextAtSize(line, contactFit.size)) / 2,
        y: footerRuleY - 2 - contactLineHeight * (i + 1) + 2.5,
        size: contactFit.size,
        font: bold,
        color: INK,
      });
    });
    page.drawText(PRESCRIPTION_FOOTER, {
      x: (PAGE_WIDTH - regular.widthOfTextAtSize(PRESCRIPTION_FOOTER, NOTE_SIZE)) / 2,
      y: noteY,
      size: NOTE_SIZE,
      font: regular,
      color: MUTED,
    });
  };

  const ensureSpace = (height: number) => {
    if (y - height < bodyBottom) newPage();
  };

  /** Draws wrapped text and moves the cursor down. */
  const paragraph = (
    value: string,
    x: number,
    size: number,
    font: PDFFont = regular,
    color = INK,
  ) => {
    for (const line of wrapText(value, font, size, PAGE_WIDTH - MARGIN_X - x)) {
      ensureSpace(size + 3);
      draw(line, x, size, font, color);
      y -= size + 3;
    }
  };

  newPage();

  // --- Medications -------------------------------------------------------------
  medications.forEach((med, index) => {
    ensureSpace(30);
    const name = clean(med.nombre, TEXT_LIMITS.short);
    const presentation = clean(med.presentacion, TEXT_LIMITS.short);
    paragraph(
      `${index + 1}. ${name}${presentation ? ` - ${presentation}` : ""}`,
      MARGIN_X,
      11,
      bold,
    );
    const details = [
      ["Dosis", clean(med.dosis, TEXT_LIMITS.short)],
      ["Vía", clean(med.via, 20)],
      ["Frecuencia", clean(med.frecuencia, TEXT_LIMITS.short)],
      ["Duración", clean(med.duracion, 80)],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`)
      .join("   ");
    if (details) paragraph(details, MARGIN_X + 14, BODY_SIZE);
    const indications = clean(med.indicaciones, TEXT_LIMITS.indications);
    if (indications) {
      paragraph(`Indicaciones: ${indications}`, MARGIN_X + 14, BODY_SIZE, regular, MUTED);
    }
    y -= 5;
  });

  // --- Signature, bottom right of the last page --------------------------------
  // Printed name and cédula under the line: shrunk, then wrapped, never
  // wider than the signature column.
  const SIGNATURE_TEXT_WIDTH = SIGNATURE_WIDTH + 30;
  const fitUnder = (value: string, font: PDFFont) => {
    for (let size = 8; size >= 6.5; size -= 0.5) {
      if (font.widthOfTextAtSize(value, size) <= SIGNATURE_TEXT_WIDTH) {
        return { size, lines: [value] };
      }
    }
    return { size: 6.5, lines: wrapText(value, font, 6.5, SIGNATURE_TEXT_WIDTH) };
  };
  const underLines = [
    { ...fitUnder(doctorName, bold), font: bold },
    { ...fitUnder(`Céd. Prof. ${cedula}`, regular), font: regular },
  ];
  const underHeight = underLines.reduce((h, part) => h + part.lines.length * (part.size + 2), 0);
  const lineX = PAGE_WIDTH - MARGIN_X - SIGNATURE_WIDTH;
  const lineY = footerRuleY + 8 + underHeight;
  // Room for the image (40 pt) above the line, below the last body line.
  ensureSpace(lineY + 46 - bodyBottom);
  const scaled = signature.scaleToFit(SIGNATURE_WIDTH, 40);
  page.drawImage(signature, {
    x: lineX + (SIGNATURE_WIDTH - scaled.width) / 2,
    y: lineY + 2,
    width: scaled.width,
    height: scaled.height,
  });
  page.drawLine({
    start: { x: lineX, y: lineY },
    end: { x: lineX + SIGNATURE_WIDTH, y: lineY },
    thickness: 0.6,
    color: INK,
  });
  const columnCenter = PAGE_WIDTH - MARGIN_X - SIGNATURE_TEXT_WIDTH / 2;
  let underY = lineY;
  for (const part of underLines) {
    for (const line of part.lines) {
      underY -= part.size + 2;
      page.drawText(line, {
        x: columnCenter - part.font.widthOfTextAtSize(line, part.size) / 2,
        y: underY,
        size: part.size,
        font: part.font,
        color: INK,
      });
    }
  }

  // --- Page numbers, only when there is more than one page ---------------------
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const label = `Página ${i + 1} de ${pages.length}`;
      p.drawText(label, {
        x: PAGE_WIDTH - MARGIN_X - regular.widthOfTextAtSize(label, NOTE_SIZE),
        y: noteY,
        size: NOTE_SIZE,
        font: regular,
        color: MUTED,
      });
    });
  }

  return doc.save();
};
