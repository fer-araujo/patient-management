import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FileSignature, Loader2, MessageCircle, Printer } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import type { Prescription } from "../../../lib/services/soapService";
import {
  PrescriberIncompleteError,
  downloadSignature,
  fetchPrescriberProfile,
  issuePrescription,
  logPrescriptionShared,
  type IssuedPrescription,
  type PrescriptionShareChannel,
} from "../../../lib/services/prescriberService";
import { missingPrescriberItems } from "./prescriberProfile";
import {
  PrescriptionPdfError,
  formatFolio,
  formatPrescriptionDate,
} from "./prescriptionPdfShared";
import {
  downloadBlob,
  hasWhatsappPhone,
  prescriptionFileName,
  prescriptionShareText,
  sharePrescriptionPdf,
} from "./sharePrescription";
import { PrescriberProfileModal } from "./PrescriberProfileModal";

export interface PrescriptionPatient {
  name: string;
  dob?: string | null;
  sex?: string | null;
  phone?: string | null;
}

interface PrescriptionPdfActionsProps {
  prescription: Prescription;
  patient: PrescriptionPatient;
  /** Called with the formatted folio once the server has issued it. */
  onIssued?: (folio: string) => void;
}

interface PreparedPdf {
  pdf: Uint8Array;
  folio: string;
  fileName: string;
  title: string;
  text: string;
  canShareFiles: boolean;
}

/**
 * How long a viewed PDF stays reachable in its tab (to print it later). It
 * is also released when this page is closed or navigated away.
 */
const VIEW_URL_LIFETIME_MS = 60 * 60_000;

const viewUrls = new Set<string>();
let releaseOnPageHide = false;

const releaseViewUrl = (url: string) => {
  if (viewUrls.delete(url)) URL.revokeObjectURL(url);
};

const keepViewUrl = (url: string) => {
  viewUrls.add(url);
  setTimeout(() => releaseViewUrl(url), VIEW_URL_LIFETIME_MS);
  if (!releaseOnPageHide && typeof window !== "undefined") {
    releaseOnPageHide = true;
    window.addEventListener("pagehide", () => {
      for (const kept of [...viewUrls]) releaseViewUrl(kept);
    });
  }
};

const blobToBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
};

const canShareFile = (fileName: string): boolean => {
  try {
    const probe = new File([new Uint8Array(1)], fileName, { type: "application/pdf" });
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      navigator.canShare?.({ files: [probe] }) === true
    );
  } catch {
    return false;
  }
};

const SENT_MESSAGES: Record<Exclude<PrescriptionShareChannel, "print">, string> = {
  share_sheet: "Receta compartida.",
  whatsapp_link: "Se descargó la receta. Adjúntala en el chat de WhatsApp que se abrió.",
  download: "Se descargó la receta; ábrela en WhatsApp manualmente.",
};

/** Same look as the "Copiar todo" buttons, 44 px tall for touch. */
const SECONDARY_CLASSES =
  "min-h-11 text-sm font-bold py-2 px-4 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-brand-dark flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm disabled:opacity-50";
const PRIMARY_CLASSES =
  "min-h-11 text-sm font-bold py-2 px-4 rounded-lg bg-brand-primary hover:bg-brand-dark text-white border-none flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm disabled:opacity-50";

/**
 * "Ver / imprimir" and "Enviar por WhatsApp" for one FINALIZED prescription.
 * The first time, the server issues it (issue_prescription): it stores the
 * doctor's printed data, the signature version and a folio, and every PDF of
 * this prescription is built from that snapshot, so later edits of her data
 * or signature never change it. pdf-lib is loaded only when a PDF is built.
 * Every PDF that leaves the app is written to the Bitácora (channel, folio).
 * Its dialogs are rendered on document.body, so the buttons also work inside
 * another Modal (e.g. "Consulta finalizada" or the calendar detail).
 */
export const PrescriptionPdfActions = ({
  prescription,
  patient,
  onIssued,
}: PrescriptionPdfActionsProps) => {
  const [busy, setBusy] = useState<"view" | "share" | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedPdf | null>(null);
  const [isSending, setIsSending] = useState(false);

  if (!prescription.finalizedAt) return null;

  const finalizedAt = prescription.finalizedAt;
  const issuedOn = formatPrescriptionDate(finalizedAt);
  const patientHasPhone = hasWhatsappPhone(patient.phone);

  /** The issue snapshot, or PrescriptionPdfError saying what she must fill in. */
  const issue = async (): Promise<IssuedPrescription> => {
    try {
      return await issuePrescription(prescription.id);
    } catch (error: unknown) {
      if (!(error instanceof PrescriberIncompleteError)) throw error;
      const lacking = missingPrescriberItems(await fetchPrescriberProfile());
      // Complete on screen but refused: the signature file itself is missing.
      throw new PrescriptionPdfError(
        "Faltan datos de la receta.",
        lacking.length > 0 ? lacking : ["Firma"],
      );
    }
  };

  /** Issues (first time) and builds the PDF from the stored snapshot. */
  const buildPdf = async (): Promise<{ pdf: Uint8Array; folio: string; doctorName: string }> => {
    const issued = await issue();
    onIssued?.(formatFolio(issued.folio));
    const signature = await downloadSignature(issued.signaturePath);
    if (!signature) {
      throw new PrescriptionPdfError("No se encontró la firma con la que se emitió esta receta.");
    }
    const { buildPrescriptionPdf } = await import("./buildPrescriptionPdf");
    const pdf = await buildPrescriptionPdf({
      prescriber: issued.prescriber,
      signaturePng: await blobToBytes(signature),
      folio: issued.folio,
      patient: { name: patient.name, dob: patient.dob, sex: patient.sex },
      prescription: { finalizedAt, medications: prescription.medications },
    });
    return {
      pdf,
      folio: formatFolio(issued.folio),
      doctorName: issued.prescriber.fullName.trim(),
    };
  };

  const reportError = (error: unknown) => {
    if (error instanceof PrescriptionPdfError && error.missing.length > 0) {
      setMissing(error.missing);
      return;
    }
    toast.error(
      error instanceof Error && error.message
        ? error.message
        : "No se pudo preparar la receta. Intenta de nuevo.",
    );
  };

  /** The PDF already left the app: a failed log is reported, not undone. */
  const audit = async (channel: PrescriptionShareChannel) => {
    try {
      await logPrescriptionShared(prescription.id, channel);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo registrar el envío en la Bitácora.",
      );
    }
  };

  const handleView = async () => {
    // Opened inside the tap, so the browser does not block it; the PDF is
    // loaded into it once built.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setBusy("view");
    try {
      const { pdf, folio } = await buildPdf();
      const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
      if (tab && !tab.closed) {
        const url = URL.createObjectURL(blob);
        tab.location.href = url;
        keepViewUrl(url);
        await audit("print");
      } else {
        downloadBlob(blob, prescriptionFileName(folio));
        toast.success("Se descargó la receta.");
        await audit("download");
      }
    } catch (error: unknown) {
      tab?.close();
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  const handlePrepareShare = async () => {
    setBusy("share");
    try {
      const { pdf, folio, doctorName } = await buildPdf();
      const fileName = prescriptionFileName(folio);
      setPrepared({
        pdf,
        folio,
        fileName,
        title: `Receta ${folio}`,
        text: prescriptionShareText(folio, doctorName),
        canShareFiles: canShareFile(fileName),
      });
    } catch (error: unknown) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  // Runs inside the tap on "Enviar por WhatsApp" in the dialog: the share
  // sheet and the WhatsApp tab need that gesture, so nothing is awaited
  // before sharePrescriptionPdf is called.
  const handleSend = async () => {
    if (!prepared || isSending) return;
    setIsSending(true);
    try {
      const channel = await sharePrescriptionPdf({ ...prepared, phone: patient.phone });
      if (!channel) return; // Closed the share sheet: nothing was sent.
      setPrepared(null);
      if (channel !== "print") toast.success(SENT_MESSAGES[channel]);
      await audit(channel);
    } catch (error: unknown) {
      reportError(error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleView}
          disabled={busy !== null}
          aria-label={`Ver o imprimir la receta del ${issuedOn}`}
          className={SECONDARY_CLASSES}
        >
          {busy === "view" ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Printer className="w-4 h-4" aria-hidden="true" />
          )}
          Ver / imprimir
        </button>
        <button
          type="button"
          onClick={handlePrepareShare}
          disabled={busy !== null}
          aria-label={`Enviar por WhatsApp la receta del ${issuedOn}`}
          className={PRIMARY_CLASSES}
        >
          {busy === "share" ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <MessageCircle className="w-4 h-4" aria-hidden="true" />
          )}
          Enviar por WhatsApp
        </button>
      </div>

      {createPortal(
        <>
          <Modal
            isOpen={prepared !== null}
            onClose={() => {
              if (!isSending) setPrepared(null);
            }}
            title="Enviar receta"
            icon={<MessageCircle className="w-6 h-6 text-brand-primary" />}
            hideFooter={true}
          >
            <div className="space-y-5 pb-2 text-center">
              <p className="text-base text-brand-dark leading-relaxed">
                La receta del {issuedOn} (folio {prepared?.folio}) está lista.
              </p>
              {!patientHasPhone && (
                <div
                  role="status"
                  className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-base text-amber-800 text-left"
                >
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                  <p>El paciente no tiene teléfono; elige el contacto en WhatsApp.</p>
                </div>
              )}
              <p className="text-base text-brand-gray leading-relaxed">
                {prepared?.canShareFiles
                  ? "Se abrirá el menú para compartir: elige WhatsApp y el chat del paciente."
                  : patientHasPhone
                    ? "Se abrirá WhatsApp con el chat del paciente y se descargará el PDF. Adjunta ahí el archivo descargado."
                    : "Se abrirá WhatsApp y se descargará el PDF. Elige el contacto y adjunta ahí el archivo descargado."}
              </p>
              <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPrepared(null)}
                  disabled={isSending}
                  className="flex-1 min-h-11 py-3.5 rounded-xl cursor-pointer text-base disabled:opacity-50"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={isSending}
                  className="flex-1 min-h-11 py-3.5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md cursor-pointer disabled:opacity-50 font-bold text-base"
                >
                  Enviar por WhatsApp
                </Button>
              </div>
            </div>
          </Modal>

          <Modal
            isOpen={missing !== null}
            onClose={() => setMissing(null)}
            title="Faltan datos de la receta"
            icon={<AlertTriangle className="w-6 h-6 text-amber-600" />}
            hideFooter={true}
          >
            <div className="space-y-5 pb-2 text-center">
              <p className="text-base text-brand-dark leading-relaxed">
                Para emitir la receta en PDF falta: {missing?.join(", ")}.
              </p>
              <div className="pt-4 border-t border-slate-100 flex gap-3 max-md:flex-col-reverse max-md:*:w-full max-md:*:flex-none">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMissing(null)}
                  className="flex-1 min-h-11 py-3.5 rounded-xl cursor-pointer text-base"
                >
                  Cerrar
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setMissing(null);
                    setIsProfileOpen(true);
                  }}
                  className="flex-1 min-h-11 py-3.5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md cursor-pointer font-bold text-base"
                >
                  <FileSignature className="w-5 h-5" aria-hidden="true" />
                  Completar datos de la receta
                </Button>
              </div>
            </div>
          </Modal>

          {isProfileOpen && (
            <PrescriberProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
          )}
        </>,
        document.body,
      )}
    </>
  );
};
