import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrescriptionDisclaimer } from "./PrescriptionDisclaimer";

describe("PrescriptionDisclaimer", () => {
  it("tells the doctor how the official PDF is issued and forbids controlled substances", () => {
    render(<PrescriptionDisclaimer />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/se puede emitir en PDF con tus datos y tu firma/);
    expect(note).toHaveTextContent(/No recetes aquí medicamentos controlados \(Grupos I a III\)/);
    expect(note).not.toHaveTextContent(/No es una receta médica oficial/);
  });

  it("tells the patient the list is a record and the signed PDF is the prescription", () => {
    render(<PrescriptionDisclaimer variant="patient" className="mb-5" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(
      "Registro de tus medicamentos. Tu receta oficial es el PDF firmado que te envía la doctora.",
    );
    expect(note).not.toHaveTextContent(/controlados/);
    expect(note.className).toContain("mb-5");
  });
});
