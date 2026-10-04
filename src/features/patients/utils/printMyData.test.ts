import { describe, expect, it, vi } from "vitest";
import type { MyDataExport } from "../../../lib/services/privacyService";
import { openMyDataWindow, renderMyDataDocument } from "./printMyData";

const XSS = "<img src=x onerror=alert(1)>";
const ESCAPED_XSS = "&lt;img src=x onerror=alert(1)&gt;";

const baseExport = (over: Partial<MyDataExport> = {}): MyDataExport => ({
  generated_at: "2026-09-24T18:00:00.000Z",
  privacy_notice_version: "2026-09-23",
  profile: {
    first_name: "Ana",
    last_name: "Pérez",
    phone: "+525512345678",
    email: "ana@example.com",
    gender: "F",
    dob: null,
    blood_type: "O+",
    allergies: "Penicilina",
    chronic_conditions: null,
    referred_by: null,
    created_at: "2026-01-10T17:00:00.000Z",
  },
  consents: [
    { document: "aviso_privacidad", version: "2026-09-23", accepted_at: "2026-09-23T16:00:00.000Z" },
  ],
  appointments: [
    {
      service: "Valoración",
      start_time: "2026-10-15T16:30:00.000Z",
      status: "confirmed",
      reason: "Dolor de espalda",
      cancel_reason: null,
    },
  ],
  prescriptions: [
    {
      created_at: "2026-09-20T16:00:00.000Z",
      medications: [{ nombre: "Ibuprofeno", dosis: "400 mg", indicaciones: "Cada 8 horas" }],
    },
  ],
  files: [{ name: "1727200000000_estudio_sangre.pdf", uploaded_at: "2026-09-20T16:00:00.000Z" }],
  arco_requests: [],
  ...over,
});

/** Renders into a fake window and returns the written HTML. */
const render = (data: MyDataExport): string => {
  const write = vi.fn();
  const win = { document: { open: vi.fn(), write, close: vi.fn() } } as unknown as Window;
  renderMyDataDocument(win, data);
  expect(write).toHaveBeenCalledTimes(1);
  return write.mock.calls[0][0] as string;
};

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("renderMyDataDocument", () => {
  it("HTML-escapes a patient-supplied name and appointment reason", () => {
    const html = render(
      baseExport({
        profile: { ...baseExport().profile!, first_name: XSS, last_name: '"Ana" & \'Co\'' },
        appointments: [
          {
            service: XSS,
            start_time: "2026-10-15T16:30:00.000Z",
            status: "cancelled",
            reason: XSS,
            cancel_reason: XSS,
          },
        ],
      }),
    );

    expect(html).not.toContain(XSS);
    expect(html).toContain(ESCAPED_XSS);
    expect(html).toContain("&quot;Ana&quot; &amp; &#39;Co&#39;");

    const doc = parse(html);
    // The payload is text, never an element or an event handler.
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    expect(doc.querySelector("[onerror]")).toBeNull();
    expect(doc.body.textContent).toContain(`Motivo: ${XSS}`);
    expect(doc.body.textContent).toContain(`Motivo de cancelación: ${XSS}`);
  });

  it("escapes every other free-text field the patient or clinic typed", () => {
    const html = render(
      baseExport({
        profile: {
          ...baseExport().profile!,
          email: XSS,
          allergies: XSS,
          chronic_conditions: XSS,
          referred_by: XSS,
          blood_type: XSS,
          gender: XSS,
          phone: XSS,
        },
        prescriptions: [
          {
            created_at: "2026-09-20T16:00:00.000Z",
            medications: [{ nombre: XSS, dosis: XSS, indicaciones: XSS }],
          },
        ],
        files: [{ name: `123_${XSS}`, uploaded_at: "2026-09-20T16:00:00.000Z" }],
        consents: [{ document: "aviso_privacidad", version: XSS, accepted_at: "2026-09-23T16:00:00.000Z" }],
        arco_requests: [
          {
            request_type: "access",
            status: "resolved",
            created_at: "2026-09-21T16:00:00.000Z",
            resolution_note: XSS,
          },
        ],
      }),
    );

    expect(html).not.toContain(XSS);
    const doc = parse(html);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    expect(doc.querySelectorAll("script")).toHaveLength(0);
  });

  it("shows stored file names without the leading timestamp prefix", () => {
    const html = render(
      baseExport({
        files: [
          { name: "1727200000000_estudio_sangre.pdf", uploaded_at: "2026-09-20T16:00:00.000Z" },
          { name: "patient-id/1727200000001_rayos x.png", uploaded_at: "2026-09-20T16:00:00.000Z" },
          { name: "receta.pdf", uploaded_at: "2026-09-20T16:00:00.000Z" },
        ],
      }),
    );
    const items = [...parse(html).querySelectorAll("li")].map((li) => li.textContent ?? "");

    expect(items.some((t) => t.startsWith("estudio_sangre.pdf ·"))).toBe(true);
    expect(items.some((t) => t.startsWith("rayos x.png ·"))).toBe(true);
    expect(items.some((t) => t.startsWith("receta.pdf ·"))).toBe(true);
    expect(html).not.toContain("1727200000000_");
    expect(html).not.toContain("patient-id/");
  });

  it("never renders clinical notes, even if the payload carried them", () => {
    const withNotes = {
      ...baseExport(),
      clinical_notes: [
        { subjective: "SECRET-SUBJECTIVE", objective: "SECRET-OBJECTIVE", plan: "SECRET-PLAN" },
      ],
    } as unknown as MyDataExport;

    const html = render(withNotes);
    const headings = [...parse(html).querySelectorAll("h2")].map((h) => h.textContent);

    expect(html).not.toContain("SECRET-");
    expect(headings).toEqual([
      "Datos personales",
      "Citas",
      "Resumen clínico",
      "Medicamentos indicados",
      "Estudios y archivos",
      "Consentimientos",
    ]);
    expect(headings.join(" ")).not.toMatch(/notas/i);
    expect(html).toContain("Tus notas de consulta forman parte del expediente de la doctora");
  });

  it("formats dates in es-MX using the clinic's local day", () => {
    // 03:00 UTC on the 25th is still the evening of the 24th in Monterrey.
    const html = render(baseExport({ generated_at: "2026-09-25T03:00:00.000Z" }));
    expect(html).toContain("Generado el 24 de septiembre de 2026");
  });

  it("shows a date-only birth date on its own day, not the previous one", () => {
    // Parsed as UTC midnight, "1975-01-01" would print as 31 Dec 1974 in Monterrey.
    const base = baseExport();
    const html = render(
      baseExport({ profile: { ...base.profile!, dob: "1975-01-01" } }),
    );
    expect(html).toContain("1 de enero de 1975");
    expect(html).not.toContain("1974");
  });

  it("shows placeholders for empty sections and translates statuses", () => {
    const html = render(
      baseExport({ appointments: [], prescriptions: [], files: [], consents: [] }),
    );
    expect(html).toContain("No hay citas registradas.");
    expect(html).toContain("No hay medicamentos registrados.");
    expect(html).toContain("No hay archivos.");
    expect(html).toContain("No hay consentimientos registrados.");

    expect(render(baseExport())).toContain("Estado: Confirmada");
  });
});

describe("openMyDataWindow", () => {
  it("opens a blank tab synchronously with a loading message", () => {
    const write = vi.fn();
    const fakeWin = { document: { write } } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(fakeWin);

    expect(openMyDataWindow()).toBe(fakeWin);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(write.mock.calls[0][0]).toContain("Preparando tus datos");
  });

  it("returns null when the popup is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openMyDataWindow()).toBeNull();
  });
});
