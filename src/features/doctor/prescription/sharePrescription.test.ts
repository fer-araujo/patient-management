import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasWhatsappPhone,
  prescriptionFileName,
  prescriptionShareText,
  sharePrescriptionPdf,
  whatsappLink,
} from "./sharePrescription";

const pdf = new Uint8Array([37, 80, 68, 70]); // "%PDF"

const input = {
  pdf,
  fileName: prescriptionFileName("000123"),
  title: "Receta 000123",
  text: prescriptionShareText("000123", "Dra. Carmen Torres"),
  phone: "+52 (55) 1234-5678",
};

const setNavigator = (share?: unknown, canShare?: unknown) => {
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, "canShare", {
    value: canShare,
    configurable: true,
    writable: true,
  });
};

let open: ReturnType<typeof vi.spyOn>;
let click: ReturnType<typeof vi.spyOn>;
/** What window.open hands back when the browser lets the tab open. */
let chatTab: { opener: unknown };

beforeEach(() => {
  chatTab = { opener: {} };
  open = vi.spyOn(window, "open").mockReturnValue(chatTab as unknown as Window);
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:test-pdf");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  setNavigator(undefined, undefined);
});

describe("share helpers", () => {
  it("names the file by folio and writes the message without the patient's name", () => {
    expect(input.fileName).toBe("receta-000123.pdf");
    expect(input.text).toBe(
      "Hola, le comparto su receta médica (folio 000123). Dra. Carmen Torres",
    );
  });

  it("builds a wa.me link with the phone digits only", () => {
    expect(whatsappLink("+52 (55) 1234-5678", "Hola & adiós")).toBe(
      "https://wa.me/525512345678?text=Hola%20%26%20adi%C3%B3s",
    );
    // Legacy MX mobile form and a bare 10-digit number.
    expect(whatsappLink("+5215512345678", "x")).toBe("https://wa.me/525512345678?text=x");
    expect(whatsappLink("5512345678", "x")).toBe("https://wa.me/525512345678?text=x");
    // No usable phone: WhatsApp asks for the contact.
    expect(whatsappLink(null, "x")).toBe("https://wa.me/?text=x");
    expect(whatsappLink("123", "x")).toBe("https://wa.me/?text=x");
  });

  it("says whether the patient has a phone WhatsApp can open", () => {
    expect(hasWhatsappPhone("+525512345678")).toBe(true);
    expect(hasWhatsappPhone("123")).toBe(false);
    expect(hasWhatsappPhone("")).toBe(false);
    expect(hasWhatsappPhone(null)).toBe(false);
  });
});

describe("sharePrescriptionPdf", () => {
  it("opens the share sheet with the PDF when the device can share files", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    setNavigator(share, canShare);

    const channel = await sharePrescriptionPdf(input);

    expect(channel).toBe("share_sheet");
    const [{ files, title, text }] = share.mock.calls[0] as [
      { files: File[]; title: string; text: string },
    ];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("receta-000123.pdf");
    expect(files[0].type).toBe("application/pdf");
    expect(title).toBe("Receta 000123");
    expect(text).toBe(input.text);
    expect(open).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("without file sharing, opens the chat IN the tap (before any await), then downloads", async () => {
    setNavigator(vi.fn(), vi.fn().mockReturnValue(false));

    // Not awaited yet: the tab must already be open synchronously.
    const pending = sharePrescriptionPdf(input);
    expect(open).toHaveBeenCalledWith(
      `https://wa.me/525512345678?text=${encodeURIComponent(input.text)}`,
      "_blank",
    );
    expect(click).toHaveBeenCalledTimes(1);

    expect(await pending).toBe("whatsapp_link");
    // The new tab cannot reach back into the app.
    expect(chatTab.opener).toBeNull();
    // Opened before the download.
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(click.mock.invocationCallOrder[0]);
  });

  it("when the browser blocks the chat, only downloads and says so (no WhatsApp claim)", async () => {
    setNavigator(undefined, undefined);
    open.mockReturnValue(null);

    expect(await sharePrescriptionPdf(input)).toBe("download");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("when window.open throws, only downloads", async () => {
    setNavigator(undefined, undefined);
    open.mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(await sharePrescriptionPdf(input)).toBe("download");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("returns null silently when the doctor closes the share sheet", async () => {
    const abort = new DOMException("Share canceled", "AbortError");
    setNavigator(vi.fn().mockRejectedValue(abort), vi.fn().mockReturnValue(true));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sharePrescriptionPdf(input)).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("after a failed share sheet, downloads only and never opens a late tab", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setNavigator(
      vi.fn().mockRejectedValue(new DOMException("No gesture", "NotAllowedError")),
      vi.fn().mockReturnValue(true),
    );

    expect(await sharePrescriptionPdf(input)).toBe("download");
    expect(click).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
