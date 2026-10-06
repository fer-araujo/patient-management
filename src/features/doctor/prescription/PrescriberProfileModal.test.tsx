import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import {
  EMPTY_PRESCRIBER_PROFILE,
  downloadSignature,
  fetchPrescriberProfile,
  savePrescriberProfile,
  uploadSignature,
  type PrescriberProfile,
} from "../../../lib/services/prescriberService";
import { PrescriberProfileModal } from "./PrescriberProfileModal";
import { PrescriberProfileButton } from "./PrescriberProfileButton";

vi.mock("../../../lib/services/prescriberService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/services/prescriberService")>()),
  fetchPrescriberProfile: vi.fn(),
  savePrescriberProfile: vi.fn(),
  uploadSignature: vi.fn(),
  downloadSignature: vi.fn(),
}));

const complete: PrescriberProfile = {
  fullName: "Dra. Carmen Torres",
  cedulaProfesional: "1234567",
  especialidad: "",
  cedulaEspecialidad: "",
  institucionTitulo: "UANL",
  consultorioDomicilio: "Av. Constitución 100",
  telefono: "",
  hasSignature: true,
  signaturePath: "signature-old.png",
};

beforeEach(() => {
  vi.mocked(fetchPrescriberProfile).mockResolvedValue({ ...EMPTY_PRESCRIBER_PROFILE });
  vi.mocked(savePrescriberProfile).mockResolvedValue();
  vi.mocked(uploadSignature).mockResolvedValue("signature-new.png");
  vi.mocked(downloadSignature).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  URL.createObjectURL = vi.fn(() => "blob:signature");
  URL.revokeObjectURL = vi.fn();
  const ctx = {
    setTransform: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array(100)], { type: "image/png" }));
  });
});

const renderModal = (onSaved = vi.fn()) => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<PrescriberProfileModal isOpen onClose={onClose} onSaved={onSaved} />);
  return { user, onClose, onSaved };
};

describe("PrescriberProfileModal", () => {
  it("warns about every missing required item of an empty profile", async () => {
    renderModal();

    const warning = await screen.findByRole("status");
    expect(warning).toHaveTextContent("Faltan datos para emitir recetas:");
    expect(warning).toHaveTextContent(
      "Nombre completo, Cédula profesional, Institución que expidió el título, Domicilio del consultorio, Firma.",
    );
  });

  it("shows the saved data and the saved signature, with no warning when complete", async () => {
    vi.mocked(fetchPrescriberProfile).mockResolvedValue(complete);
    renderModal();

    expect(await screen.findByDisplayValue("Dra. Carmen Torres")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Tus datos están completos.");
    expect(await screen.findByRole("img", { name: "Firma guardada" })).toHaveAttribute(
      "src",
      "blob:signature",
    );
    expect(downloadSignature).toHaveBeenCalledTimes(1);
    expect(downloadSignature).toHaveBeenCalledWith("signature-old.png");
  });

  it("saves the typed fields and reports the new state", async () => {
    const toastSuccess = vi.spyOn(toast, "success");
    const { user, onSaved } = renderModal();
    await screen.findByRole("status");

    await user.type(screen.getByLabelText(/Nombre completo/), "Dra. Carmen Torres");
    await user.type(screen.getByLabelText(/Cédula profesional/), "1234567");
    await user.type(screen.getByLabelText(/Institución que expidió el título/), "UANL");
    await user.type(screen.getByLabelText(/Domicilio del consultorio/), "Av. Constitución 100");
    await user.click(screen.getByRole("button", { name: /Guardar datos/ }));

    await waitFor(() => expect(savePrescriberProfile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(savePrescriberProfile).mock.calls[0][0]).toMatchObject({
      fullName: "Dra. Carmen Torres",
      cedulaProfesional: "1234567",
      institucionTitulo: "UANL",
      consultorioDomicilio: "Av. Constitución 100",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Datos de la receta guardados.");
    // Only the signature is still missing.
    expect(screen.getByRole("status")).toHaveTextContent("Firma.");
    expect(onSaved).toHaveBeenLastCalledWith(
      expect.objectContaining({ fullName: "Dra. Carmen Torres", hasSignature: false }),
    );
  });

  it("does not save a cédula with letters", async () => {
    const { user } = renderModal();
    await screen.findByRole("status");

    await user.type(screen.getByLabelText(/Cédula profesional/), "12AB34");
    await user.click(screen.getByRole("button", { name: /Guardar datos/ }));

    expect(await screen.findByText("Escribe solo los números de la cédula.")).toBeInTheDocument();
    expect(savePrescriberProfile).not.toHaveBeenCalled();
  });

  it("draws and saves the signature, then shows it", async () => {
    vi.mocked(fetchPrescriberProfile).mockResolvedValue({
      ...complete,
      hasSignature: false,
      signaturePath: "",
    });
    const { user, onSaved } = renderModal();
    await screen.findByRole("status");
    expect(screen.getByRole("status")).toHaveTextContent("Firma.");

    const pad = screen.getByRole("img", { name: "Área para dibujar la firma" });
    fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 80, clientY: 30 });
    fireEvent.pointerUp(pad, { pointerId: 1, isPrimary: true });
    await user.click(screen.getByRole("button", { name: /Guardar firma/ }));

    await waitFor(() => expect(uploadSignature).toHaveBeenCalledTimes(1));
    expect(vi.mocked(uploadSignature).mock.calls[0][0].type).toBe("image/png");
    expect(await screen.findByRole("img", { name: "Firma guardada" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Tus datos están completos.");
    expect(onSaved).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasSignature: true, signaturePath: "signature-new.png" }),
    );
    // The preview reads the new version.
    expect(downloadSignature).toHaveBeenLastCalledWith("signature-new.png");
  });

  it("a text save finishing after a signature save keeps the signature (no stale state)", async () => {
    vi.mocked(fetchPrescriberProfile).mockResolvedValue({
      ...complete,
      hasSignature: false,
      signaturePath: "",
    });
    let finishTextSave!: () => void;
    vi.mocked(savePrescriberProfile).mockImplementation(
      () => new Promise<void>((resolve) => {
        finishTextSave = resolve;
      }),
    );
    const { user, onSaved } = renderModal();
    await screen.findByRole("status");

    // Text save starts and waits on the network...
    await user.click(screen.getByRole("button", { name: /Guardar datos/ }));
    await waitFor(() => expect(savePrescriberProfile).toHaveBeenCalledTimes(1));

    // ...meanwhile the signature is saved...
    const pad = screen.getByRole("img", { name: "Área para dibujar la firma" });
    fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 80, clientY: 30 });
    fireEvent.pointerUp(pad, { pointerId: 1, isPrimary: true });
    await user.click(screen.getByRole("button", { name: /Guardar firma/ }));
    await waitFor(() => expect(uploadSignature).toHaveBeenCalledTimes(1));
    await screen.findByRole("img", { name: "Firma guardada" });

    // ...and then the text save finishes: the signature must survive.
    finishTextSave();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Tus datos están completos."),
    );
    expect(onSaved).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasSignature: true, signaturePath: "signature-new.png" }),
    );
  });

  it("offers a retry when the data cannot be read", async () => {
    vi.mocked(fetchPrescriberProfile)
      .mockRejectedValueOnce(new Error("No se pudieron cargar los datos de la receta."))
      .mockResolvedValue(complete);
    const { user } = renderModal();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los datos de la receta.",
    );
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByDisplayValue("Dra. Carmen Torres")).toBeInTheDocument();
  });
});

describe("PrescriberProfileButton", () => {
  it("says when data is missing and opens the form", async () => {
    const user = userEvent.setup();
    render(<PrescriberProfileButton />);

    expect(await screen.findByText("Faltan datos")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Datos de la receta/ }));
    expect(await screen.findByRole("heading", { name: "Datos de la receta" })).toBeInTheDocument();
  });

  it("shows no warning when the data is complete", async () => {
    vi.mocked(fetchPrescriberProfile).mockResolvedValue(complete);
    render(<PrescriberProfileButton />);
    await waitFor(() => expect(fetchPrescriberProfile).toHaveBeenCalled());
    expect(screen.queryByText("Faltan datos")).not.toBeInTheDocument();
  });
});
