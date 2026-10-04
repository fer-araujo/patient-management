import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PrivacyConsentCheckbox,
  PrivacyConsentModals,
  type LegalDocument,
} from "./PrivacyConsent";

/** The checkbox inside a real form, wired like the screens that use it. */
const ConsentForm = ({ onOpenDocument }: { onOpenDocument: (d: LegalDocument) => void }) => {
  const [checked, setChecked] = useState(false);
  return (
    <form aria-label="consent form">
      <PrivacyConsentCheckbox
        checked={checked}
        onChange={setChecked}
        onOpenDocument={onOpenDocument}
      />
    </form>
  );
};

describe("PrivacyConsentCheckbox", () => {
  it("is a required checkbox, so an unticked form is invalid", async () => {
    const user = userEvent.setup();
    render(<ConsentForm onOpenDocument={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox");
    const form = screen.getByRole("form", { name: "consent form" }) as HTMLFormElement;

    expect(checkbox).toBeRequired();
    expect(checkbox).not.toBeChecked();
    expect(form.checkValidity()).toBe(false);

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(form.checkValidity()).toBe(true);
  });

  it("states express consent for health data", () => {
    render(<ConsentForm onOpenDocument={vi.fn()} />);
    expect(screen.getByRole("checkbox")).toHaveAccessibleName(
      expect.stringContaining("doy mi consentimiento expreso"),
    );
  });

  it("opens the legal documents without ticking the box", async () => {
    const user = userEvent.setup();
    const onOpenDocument = vi.fn();
    render(<ConsentForm onOpenDocument={onOpenDocument} />);

    await user.click(screen.getByRole("button", { name: "Aviso de Privacidad" }));
    await user.click(screen.getByRole("button", { name: "Términos y Condiciones" }));

    expect(onOpenDocument).toHaveBeenNthCalledWith(1, "privacy");
    expect(onOpenDocument).toHaveBeenNthCalledWith(2, "terms");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});

describe("PrivacyConsentModals", () => {
  it("shows only the requested document", () => {
    const { rerender } = render(<PrivacyConsentModals openDocument={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Aviso de Privacidad" })).not.toBeInTheDocument();

    rerender(<PrivacyConsentModals openDocument="privacy" onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Aviso de Privacidad" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Términos y Condiciones de Uso" }),
    ).not.toBeInTheDocument();
  });

  it("closes through the Entendido button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PrivacyConsentModals openDocument="terms" onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Entendido" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
