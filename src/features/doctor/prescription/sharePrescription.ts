import { normalizeToE164 } from "../../../lib/phone";
import type { PrescriptionShareChannel } from "../../../lib/services/prescriberService";

/**
 * Getting the prescription PDF to the patient without any paid service:
 *   - iPad / phone: the system share sheet with the PDF attached, where the
 *     doctor picks WhatsApp and the patient's chat;
 *   - desktop (no file sharing): WhatsApp opens the patient's chat and the
 *     PDF is downloaded, so she attaches the file there.
 * Nothing here talks to the database; the caller logs the returned channel,
 * which says only what really happened (see PrescriptionShareChannel).
 */

/** The file name carries the folio only, never the patient's name. */
export const prescriptionFileName = (folio: string): string => `receta-${folio}.pdf`;

/** Short message without the patient's name or any clinical data. */
export const prescriptionShareText = (folio: string, doctorName: string): string =>
  `Hola, le comparto su receta médica (folio ${folio}). ${doctorName}`.trim();

/** True when the phone can open the patient's own WhatsApp chat. */
export const hasWhatsappPhone = (phone: string | null | undefined): boolean =>
  normalizeToE164(phone) !== null;

/** wa.me link to the patient's chat (digits only), or to WhatsApp's contact picker. */
export const whatsappLink = (phone: string | null | undefined, text: string): string => {
  const e164 = normalizeToE164(phone);
  const digits = e164 ? e164.replace(/\D/g, "") : "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
};

/** Saves `blob` as `fileName` through a temporary link. */
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Long enough for the browser to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * Opens `url` in a new tab and says whether the browser really opened it
 * (a blocked pop-up returns null). "noopener" is not passed because with it
 * window.open always returns null; the opener is cut by hand instead.
 */
const openTab = (url: string): boolean => {
  try {
    const tab = window.open(url, "_blank");
    if (!tab) return false;
    try {
      tab.opener = null;
    } catch {
      // Some browsers expose a read-only opener; the tab is open anyway.
    }
    return true;
  } catch {
    return false;
  }
};

export interface SharePrescriptionInput {
  pdf: Uint8Array;
  fileName: string;
  title: string;
  text: string;
  phone: string | null | undefined;
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error
    ? error.name === "AbortError"
    : typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";

/**
 * Must be CALLED inside the tap that asked for it, before any await of the
 * caller: the share sheet and the new WhatsApp tab both need that gesture.
 *
 * Returns the channel that really happened:
 *   - "share_sheet": the share sheet finished;
 *   - "whatsapp_link": the chat opened AND the PDF was downloaded;
 *   - "download": only the PDF was downloaded (the share sheet failed, or the
 *     browser blocked the chat); the doctor opens WhatsApp herself;
 *   - null: she closed the share sheet without sending (nothing to log).
 */
export const sharePrescriptionPdf = async (
  input: SharePrescriptionInput,
): Promise<PrescriptionShareChannel | null> => {
  // Copy into a plain ArrayBuffer-backed array for the File constructor.
  const file = new File([new Uint8Array(input.pdf)], input.fileName, {
    type: "application/pdf",
  });

  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  let canShareFile = false;
  try {
    canShareFile =
      typeof nav?.share === "function" && nav.canShare?.({ files: [file] }) === true;
  } catch {
    canShareFile = false;
  }

  if (canShareFile && nav) {
    try {
      await nav.share({ files: [file], title: input.title, text: input.text });
      return "share_sheet";
    } catch (error: unknown) {
      if (isAbort(error)) return null;
      console.error("[sharePrescription] share failed:", error instanceof Error ? error.name : error);
      // The tap's gesture is spent: a new tab would be blocked now. Download
      // only, and let the caller say so.
      downloadBlob(file, input.fileName);
      return "download";
    }
  }

  // No await above on this path: still inside the tap, so the chat can open.
  const chatOpened = openTab(whatsappLink(input.phone, input.text));
  downloadBlob(file, input.fileName);
  return chatOpened ? "whatsapp_link" : "download";
};
