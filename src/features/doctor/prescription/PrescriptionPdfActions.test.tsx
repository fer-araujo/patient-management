import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import {
  PrescriberIncompleteError,
  downloadSignature,
  fetchPrescriberProfile,
  issuePrescription,
  logPrescriptionShared,
  type IssuedPrescription,
  type PrescriberProfile,
} from "../../../lib/services/prescriberService";
import type { Prescription } from "../../../lib/services/soapService";
import { TEST_SIGNATURE_PNG } from "../../../test/signaturePng";
import { buildPrescriptionPdf } from "./buildPrescriptionPdf";
import { PrescriptionPdfActions } from "./PrescriptionPdfActions";

vi.mock("../../../lib/services/prescriberService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/services/prescriberService")>()),
  fetchPrescriberProfile: vi.fn(),
  downloadSignature: vi.fn(),
  issuePrescription: vi.fn(),
  logPrescriptionShared: vi.fn(),
  savePrescriberProfile: vi.fn(),
  uploadSignature: vi.fn(),
}));

// The builder has its own tests; here only what it is given matters.
vi.mock("./buildPrescriptionPdf", () => ({
  buildPrescriptionPdf: vi.fn(),
}));

const currentProfile: PrescriberProfile = {
  fullName: "Dra. Carmen Torres (datos nuevos)",
  cedulaProfesional: "1234567",
  especialidad: "Dermatología",
  cedulaEspecialidad: "",
  institucionTitulo: "UANL",
  consultorioDomicilio: "Av. Constitución 100, Monterrey",
  telefono: "81 1234 5678",
  hasSignature: true,
  signaturePath: "signature-new.png",
};

const issued: IssuedPrescription = {
  folio: 123,
  issuedAt: "2026-10-05T17:05:00+00:00",
  signaturePath: "signature-old.png",
  prescriber: {
    fullName: "Dra. Carmen Torres",
    cedulaProfesional: "1234567",
    especialidad: "Dermatología",
    cedulaEspecialidad: "",
    institucionTitulo: "UANL",
    consultorioDomicilio: "Av. Constitución 100, Monterrey",
    telefono: "81 1234 5678",
  },
};

const finalized: Prescription = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  appointmentId: "appt-0",
  patientId: "patient-1",
  medications: [
    { nombre: "Ibuprofeno", dosis: "1 tableta", via: "Oral", frecuencia: "Cada 8 h", indicaciones: "" },
  ],
  createdAt: "2026-10-05T16:00:00Z",
  finalizedAt: "2026-10-05T17:00:00Z",
};

const patient = { name: "Ana Pérez", dob: "1958-01-10", sex: "Femenino", phone: "+525512345678" };

const setNavigator = (share?: unknown, canShare?: unknown) => {
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true, writable: true });
};

let open: ReturnType<typeof vi.spyOn>;
let click: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(issuePrescription).mockResolvedValue(issued);
  vi.mocked(fetchPrescriberProfile).mockResolvedValue(currentProfile);
  vi.mocked(downloadSignature).mockResolvedValue(
    new Blob([TEST_SIGNATURE_PNG], { type: "image/png" }),
  );
  vi.mocked(buildPrescriptionPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  vi.mocked(logPrescriptionShared).mockResolvedValue();
  open = vi.spyOn(window, "open").mockReturnValue(null);
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:receta");
  URL.revokeObjectURL = vi.fn();
  // "Datos de la receta" holds the signature pad; jsdom has no canvas.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  setNavigator(undefined, undefined);
});

const renderActions = (
  prescription: Prescription = finalized,
  who: typeof patient | (Omit<typeof patient, "phone"> & { phone: string | null }) = patient,
) => {
  const user = userEvent.setup();
  render(<PrescriptionPdfActions prescription={prescription} patient={who} />);
  return { user };
};

const sendButton = () => screen.getByRole("button", { name: /^Enviar por WhatsApp la receta/ });
const viewButton = () => screen.getByRole("button", { name: /^Ver o imprimir la receta/ });

/** "Enviar por WhatsApp" on the card, then the same button in the dialog. */
const openDialogAndSend = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(sendButton());
  await screen.findByRole("heading", { name: "Enviar receta" });
  await user.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }));
};

describe("PrescriptionPdfActions", () => {
  it("shows nothing for a prescription that is not finalized", () => {
    renderActions({ ...finalized, finalizedAt: null });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("builds the PDF from the issue snapshot, never from the current data", async () => {
    setNavigator(vi.fn().mockResolvedValue(undefined), vi.fn().mockReturnValue(true));
    const { user } = renderActions();

    await user.click(sendButton());
    await screen.findByRole("heading", { name: "Enviar receta" });

    expect(issuePrescription).toHaveBeenCalledWith(finalized.id);
    expect(downloadSignature).toHaveBeenCalledWith("signature-old.png");
    expect(fetchPrescriberProfile).not.toHaveBeenCalled();
    const [built] = vi.mocked(buildPrescriptionPdf).mock.calls[0];
    expect(built.prescriber).toEqual(issued.prescriber);
    expect(built.folio).toBe(123);
    expect(built.prescription).toEqual({
      finalizedAt: finalized.finalizedAt,
      medications: finalized.medications,
    });
    expect(screen.getByText(/\(folio 000123\) está lista/)).toBeInTheDocument();
  });

  it("shares the PDF through the share sheet and logs it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator(share, vi.fn().mockReturnValue(true));
    const toastSuccess = vi.spyOn(toast, "success");
    const { user } = renderActions();

    await user.click(sendButton());
    await screen.findByRole("heading", { name: "Enviar receta" });
    expect(screen.getByText(/elige WhatsApp y el chat del paciente/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    expect(files[0].name).toBe("receta-000123.pdf");
    expect(files[0].type).toBe("application/pdf");
    await waitFor(() =>
      expect(logPrescriptionShared).toHaveBeenCalledWith(finalized.id, "share_sheet"),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Receta compartida.");
    expect(open).not.toHaveBeenCalled();
  });

  it("without file sharing, opens the patient's chat, downloads the PDF and logs whatsapp_link", async () => {
    setNavigator(undefined, undefined);
    const chatTab = { opener: {} };
    open.mockReturnValue(chatTab as unknown as Window);
    const toastSuccess = vi.spyOn(toast, "success");
    const { user } = renderActions();

    await user.click(sendButton());
    expect(await screen.findByText(/se descargará el PDF/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar por WhatsApp" }));

    await waitFor(() =>
      expect(logPrescriptionShared).toHaveBeenCalledWith(finalized.id, "whatsapp_link"),
    );
    const [url] = open.mock.calls[0] as [string];
    expect(url.startsWith("https://wa.me/525512345678?text=")).toBe(true);
    expect(decodeURIComponent(url)).not.toContain("Ana");
    expect(click).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Se descargó la receta. Adjúntala en el chat de WhatsApp que se abrió.",
    );
  });

  it("when the browser blocks the chat, says it was only downloaded and logs download", async () => {
    setNavigator(undefined, undefined);
    open.mockReturnValue(null);
    const toastSuccess = vi.spyOn(toast, "success");
    const { user } = renderActions();

    await openDialogAndSend(user);

    await waitFor(() =>
      expect(logPrescriptionShared).toHaveBeenCalledWith(finalized.id, "download"),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Se descargó la receta; ábrela en WhatsApp manualmente.",
    );
    expect(toastSuccess).not.toHaveBeenCalledWith(
      "Se descargó la receta. Adjúntala en el chat de WhatsApp que se abrió.",
    );
    expect(logPrescriptionShared).not.toHaveBeenCalledWith(finalized.id, "whatsapp_link");
  });

  it("when the share sheet fails, downloads only, says so honestly and logs download", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setNavigator(
      vi.fn().mockRejectedValue(new DOMException("No gesture", "NotAllowedError")),
      vi.fn().mockReturnValue(true),
    );
    const toastSuccess = vi.spyOn(toast, "success");
    const { user } = renderActions();

    await openDialogAndSend(user);

    await waitFor(() =>
      expect(logPrescriptionShared).toHaveBeenCalledWith(finalized.id, "download"),
    );
    expect(open).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Se descargó la receta; ábrela en WhatsApp manualmente.",
    );
  });

  it("a cancelled share sheet shows no error and logs nothing", async () => {
    setNavigator(
      vi.fn().mockRejectedValue(new DOMException("Share canceled", "AbortError")),
      vi.fn().mockReturnValue(true),
    );
    const toastError = vi.spyOn(toast, "error");
    const { user } = renderActions();

    await openDialogAndSend(user);

    // The dialog stays open so she can try again.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar por WhatsApp" })).toBeEnabled(),
    );
    expect(screen.getByRole("heading", { name: "Enviar receta" })).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    expect(logPrescriptionShared).not.toHaveBeenCalled();
  });

  it("warns when the patient has no phone WhatsApp can open", async () => {
    setNavigator(undefined, undefined);
    const { user } = renderActions(finalized, { ...patient, phone: null });

    await user.click(sendButton());

    expect(
      await screen.findByText("El paciente no tiene teléfono; elige el contacto en WhatsApp."),
    ).toBeInTheDocument();
  });

  it("does not warn about the phone when the patient has one", async () => {
    setNavigator(undefined, undefined);
    const { user } = renderActions();

    await user.click(sendButton());
    await screen.findByRole("heading", { name: "Enviar receta" });

    expect(screen.queryByText(/no tiene teléfono/)).not.toBeInTheDocument();
  });

  it("Ver / imprimir opens the PDF in a new tab, logs print and keeps it for an hour", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const tab = { location: { href: "" }, closed: false, close: vi.fn(), opener: {} };
    open.mockReturnValue(tab as unknown as Window);
    const { user } = renderActions();

    await user.click(viewButton());

    await waitFor(() => expect(tab.location.href).toBe("blob:receta"));
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(logPrescriptionShared).toHaveBeenCalledWith(finalized.id, "print"));

    // Still reachable (e.g. to print later); released after one hour.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const release = setTimeoutSpy.mock.calls.find(([, ms]) => ms === 60 * 60_000);
    expect(release).toBeDefined();
    (release![0] as () => void)();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:receta");
  });

  it("Ver / imprimir downloads and logs download when the tab was blocked", async () => {
    open.mockReturnValue(null);
    const { user } = renderActions();

    await user.click(viewButton());

    await waitFor(() =>
      expect(logPrescriptionShared).toHaveBeenCalledWith(finalized.id, "download"),
    );
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("blocks an incomplete profile and links to Datos de la receta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(issuePrescription).mockRejectedValue(new PrescriberIncompleteError());
    vi.mocked(fetchPrescriberProfile).mockResolvedValue({
      ...currentProfile,
      cedulaProfesional: "",
      hasSignature: false,
      signaturePath: "",
    });
    const tab = { location: { href: "" }, closed: false, close: vi.fn(), opener: {} };
    open.mockReturnValue(tab as unknown as Window);
    const { user } = renderActions();

    await user.click(viewButton());

    const heading = await screen.findByRole("heading", { name: "Faltan datos de la receta" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("Para emitir la receta en PDF falta: Cédula profesional, Firma.")).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
    expect(downloadSignature).not.toHaveBeenCalled();
    expect(logPrescriptionShared).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Completar datos de la receta/ }));
    const form = await screen.findByRole("heading", { name: "Datos de la receta" });
    expect(form).toBeInTheDocument();
  });

  it("an incomplete profile also blocks WhatsApp", async () => {
    vi.mocked(issuePrescription).mockRejectedValue(new PrescriberIncompleteError());
    vi.mocked(fetchPrescriberProfile).mockResolvedValue({ ...currentProfile, fullName: " " });
    const { user } = renderActions();

    await user.click(sendButton());

    expect(await screen.findByText(/falta: Nombre completo\./)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Enviar receta" })).not.toBeInTheDocument();
  });

  it("shows the server's refusal when the prescription cannot be issued", async () => {
    vi.mocked(issuePrescription).mockRejectedValue(
      new Error("Solo se puede emitir la receta de una consulta finalizada."),
    );
    const toastError = vi.spyOn(toast, "error");
    const { user } = renderActions();

    await user.click(sendButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Solo se puede emitir la receta de una consulta finalizada.",
      ),
    );
    expect(buildPrescriptionPdf).not.toHaveBeenCalled();
  });

  it("reports a failed Bitácora entry after the PDF left", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setNavigator(vi.fn().mockResolvedValue(undefined), vi.fn().mockReturnValue(true));
    vi.mocked(logPrescriptionShared).mockRejectedValue(
      new Error("No se pudo registrar el envío de la receta en la Bitácora."),
    );
    const toastError = vi.spyOn(toast, "error");
    const { user } = renderActions();

    await openDialogAndSend(user);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "No se pudo registrar el envío de la receta en la Bitácora.",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Enviar receta" })).not.toBeInTheDocument(),
    );
  });
});
