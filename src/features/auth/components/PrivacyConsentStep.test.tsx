import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PRIVACY_NOTICE_VERSION } from "../../../lib/legal/privacyNotice";
import { PrivacyConsentStep } from "./PrivacyConsentStep";

describe("PrivacyConsentStep", () => {
  it("requires the consent checkbox before continuing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PrivacyConsentStep firstName="Ana" onBack={vi.fn()} onSubmit={onSubmit} />);
    const continueButton = screen.getByRole("button", { name: "Continuar" });

    expect(screen.getByRole("heading", { name: "Hola, Ana." })).toBeInTheDocument();
    expect(continueButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(continueButton).toBeEnabled();

    await user.click(continueButton);
    expect(onSubmit).toHaveBeenCalledWith(PRIVACY_NOTICE_VERSION);
  });
});
