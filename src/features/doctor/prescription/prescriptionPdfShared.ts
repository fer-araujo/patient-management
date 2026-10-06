import { CLINIC_TIME_ZONE } from "../../../lib/clinicTime";

/**
 * The parts of the prescription PDF the screens need without loading
 * pdf-lib (which is only imported when a PDF is actually built).
 */

export const PRESCRIPTION_FOOTER =
  "Receta emitida electrónicamente. Firma electrónica simple.";

export class PrescriptionPdfError extends Error {
  /** What the prescriber data lacks, when that is the reason. */
  readonly missing: string[];

  constructor(message: string, missing: string[] = []) {
    super(message);
    this.name = "PrescriptionPdfError";
    this.missing = missing;
  }
}

/**
 * The folio the database assigned at the first issue, zero-padded to six
 * digits ("000123"); longer numbers are never cut.
 */
export const formatFolio = (folio: number): string => String(folio).padStart(6, "0");

/** "5 de octubre de 2026" on the clinic's calendar. */
export const formatPrescriptionDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: CLINIC_TIME_ZONE,
  });
