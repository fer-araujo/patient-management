import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { PRIVACY_NOTICE_VERSION } from "../../../lib/legal/privacyNotice";
import { PatientRegistration } from "./PatientRegistration";

const renderForm = () => {
  const onSubmit = vi.fn();
  const onBack = vi.fn();
  const { container } = render(<PatientRegistration onSubmit={onSubmit} onBack={onBack} />);
  // The native file input is visually hidden behind a drop zone and has no label.
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  // applyAccept: false lets the test pick a disallowed file, as a user can
  // with "All files" in the OS dialog; the component must still reject it.
  const user = userEvent.setup({ applyAccept: false });
  return { onSubmit, onBack, fileInput, user };
};

const fillRequiredFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText("Nombre Completo"), "María López");
  await user.type(screen.getByLabelText("Año de Nacimiento"), "1975");
};

const submitButton = () => screen.getByRole("button", { name: "Crear Expediente" });

describe("PatientRegistration", () => {
  it("keeps submit disabled until the consent checkbox is ticked", async () => {
    const { user, onSubmit } = renderForm();

    expect(submitButton()).toBeDisabled();
    await fillRequiredFields(user);
    expect(submitButton()).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(submitButton()).toBeEnabled();

    await user.click(screen.getByRole("checkbox"));
    expect(submitButton()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the form data with the accepted privacy notice version", async () => {
    const { user, onSubmit } = renderForm();
    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("¿Quién te refirió con nosotros? (Opcional)"), "Laura");
    await user.click(screen.getByRole("checkbox"));

    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      fullName: "María López",
      birthYear: "1975",
      email: "",
      referredBy: "Laura",
      termsAccepted: true,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      file: null,
    });
  });

  it("keeps only digits in the birth year, up to four", async () => {
    const { user } = renderForm();
    const year = screen.getByLabelText("Año de Nacimiento");
    await user.type(year, "19a7-5 99");
    expect(year).toHaveValue("1975");
  });

  it("rejects a disallowed file type with a toast and does not submit it", async () => {
    const toastError = vi.spyOn(toast, "error");
    const { user, onSubmit, fileInput } = renderForm();

    await user.upload(
      fileInput,
      new File(["MZ"], "programa.exe", { type: "application/x-msdownload" }),
    );

    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining('El archivo "programa.exe" no se puede subir.'),
    );
    expect(screen.getByText("Toca aquí para subir o tomar foto")).toBeInTheDocument();
    expect(fileInput.value).toBe("");

    await fillRequiredFields(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ file: null }));
  });

  it("rejects a file larger than 10 MB", async () => {
    const toastError = vi.spyOn(toast, "error");
    const { user, fileInput } = renderForm();
    const big = new File(["x"], "resonancia.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });

    await user.upload(fileInput, big);

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("El máximo permitido es 10 MB"));
    expect(screen.queryByText("resonancia.pdf")).not.toBeInTheDocument();
  });

  it("passes a valid file up in the submitted data", async () => {
    const toastError = vi.spyOn(toast, "error");
    const { user, onSubmit, fileInput } = renderForm();
    const study = new File(["%PDF-1.7"], "estudio.pdf", { type: "application/pdf" });

    await user.upload(fileInput, study);

    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByText("estudio.pdf")).toBeInTheDocument();
    expect(screen.getByText("Archivo adjunto")).toBeInTheDocument();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].file).toBe(study);
  });

  it("does not submit while a submission is in progress", async () => {
    const onSubmit = vi.fn();
    render(<PatientRegistration isSubmitting onSubmit={onSubmit} onBack={vi.fn()} />);
    const user = userEvent.setup();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("checkbox"));

    expect(submitButton()).toBeDisabled();
  });
});
