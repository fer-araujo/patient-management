import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignaturePad } from "./SignaturePad";
import { SIGNATURE_MAX_BYTES } from "../../../lib/services/prescriberService";

/** jsdom has no canvas: a drawing context double that records strokes. */
const makeContext = () => ({
  setTransform: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  lineCap: "",
  lineJoin: "",
  lineWidth: 0,
  strokeStyle: "",
  fillStyle: "",
});

let ctx: ReturnType<typeof makeContext>;
let pngSize = 2048;

beforeEach(() => {
  ctx = makeContext();
  pngSize = 2048;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    callback: BlobCallback,
  ) {
    callback(new Blob([new Uint8Array(pngSize)], { type: "image/png" }));
  });
});

/** jsdom has no ResizeObserver: a double the test can fire by hand. */
let resizeCallbacks: (() => void)[] = [];
class FakeResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe() {
    resizeCallbacks.push(this.callback);
  }
  unobserve() {}
  disconnect() {
    resizeCallbacks = resizeCallbacks.filter((c) => c !== this.callback);
  }
}

beforeEach(() => {
  resizeCallbacks = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const padElement = () => screen.getByRole("img", { name: "Área para dibujar la firma" });

/** A real signature: one primary pointer, long enough and wide enough. */
const draw = () => {
  const pad = padElement();
  fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, clientX: 10, clientY: 20 });
  fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 40, clientY: 30 });
  fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 80, clientY: 25 });
  fireEvent.pointerUp(pad, { pointerId: 1, isPrimary: true });
};

const saveButton = () => screen.getByRole("button", { name: /Guardar firma/ });

describe("SignaturePad", () => {
  it("draws with pointer events and saves a PNG", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SignaturePad onSave={onSave} />);

    const save = screen.getByRole("button", { name: /Guardar firma/ });
    expect(save).toBeDisabled();

    draw();

    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);
    expect(ctx.lineTo).toHaveBeenLastCalledWith(80, 25);
    expect(save).toBeEnabled();

    await user.click(save);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [png] = onSave.mock.calls[0] as [Blob];
    expect(png.type).toBe("image/png");
    // Saved: the pad is empty again.
    expect(screen.getByRole("button", { name: /Guardar firma/ })).toBeDisabled();
  });

  it("moving without pressing draws nothing", () => {
    render(<SignaturePad onSave={vi.fn()} />);
    const pad = padElement();
    fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 40, clientY: 30 });
    expect(ctx.lineTo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Guardar firma/ })).toBeDisabled();
  });

  it("Borrar clears the pad", async () => {
    const user = userEvent.setup();
    render(<SignaturePad onSave={vi.fn()} />);
    draw();

    await user.click(screen.getByRole("button", { name: /Borrar/ }));

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Guardar firma/ })).toBeDisabled();
  });

  it("refuses an oversized signature without saving it", async () => {
    pngSize = SIGNATURE_MAX_BYTES + 1;
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<SignaturePad onSave={onSave} />);
    draw();

    await user.click(screen.getByRole("button", { name: /Guardar firma/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/demasiado grande/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the save error and keeps the drawing", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("No se pudo guardar la firma. Intenta de nuevo."));
    const user = userEvent.setup();
    render(<SignaturePad onSave={onSave} />);
    draw();

    await user.click(screen.getByRole("button", { name: /Guardar firma/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la firma. Intenta de nuevo.");
    expect(screen.getByRole("button", { name: /Guardar firma/ })).toBeEnabled();
  });

  it("ignores a second finger or a palm (non-primary pointers)", () => {
    render(<SignaturePad onSave={vi.fn()} />);
    const pad = padElement();

    fireEvent.pointerDown(pad, { pointerId: 2, isPrimary: false, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(pad, { pointerId: 2, isPrimary: false, clientX: 90, clientY: 90 });
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
    expect(saveButton()).toBeDisabled();

    // While the first finger draws, another pointer's moves are ignored.
    fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(pad, { pointerId: 3, isPrimary: false, clientX: 150, clientY: 150 });
    expect(ctx.lineTo).not.toHaveBeenCalled();
    fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 90, clientY: 30 });
    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
  });

  it("does not offer to save a dot or a tiny scribble", () => {
    render(<SignaturePad onSave={vi.fn()} />);
    const pad = padElement();

    // A tap.
    fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(pad, { pointerId: 1, isPrimary: true });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/Firma muy pequeña/)).toBeInTheDocument();

    // A short line (20 px): still too small.
    fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 30, clientY: 20 });
    fireEvent.pointerUp(pad, { pointerId: 1, isPrimary: true });
    expect(saveButton()).toBeDisabled();

    // Long enough but squeezed into a tiny box (zig-zag in 10 px): too small.
    for (let i = 0; i < 10; i += 1) {
      fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 18, clientY: 26 });
      fireEvent.pointerUp(pad, { pointerId: 1, isPrimary: true });
    }
    expect(saveButton()).toBeDisabled();

    draw();
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(/Firma muy pequeña/)).not.toBeInTheDocument();
  });

  it("scales the pointer to the drawing when the pad is displayed at another size", () => {
    Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 600,
    });
    const rect = vi
      .spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 0, top: 0, width: 300, height: 100, right: 300, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    try {
      render(<SignaturePad onSave={vi.fn()} />);
      const pad = padElement();
      fireEvent.pointerDown(pad, { pointerId: 1, isPrimary: true, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(pad, { pointerId: 1, isPrimary: true, clientX: 150, clientY: 50 });
      // 300 px shown for a 600 x 200 drawing: twice the pointer position.
      expect(ctx.lineTo).toHaveBeenLastCalledWith(300, 100);
    } finally {
      rect.mockRestore();
      delete (HTMLCanvasElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it("erases the drawing and says so when the pad changes size (iPad rotated)", () => {
    let width = 600;
    Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
      configurable: true,
      get: () => width,
    });
    try {
      render(<SignaturePad onSave={vi.fn()} />);
      draw();
      expect(saveButton()).toBeEnabled();

      // Same width: nothing happens.
      act(() => resizeCallbacks.forEach((cb) => cb()));
      expect(saveButton()).toBeEnabled();

      width = 800;
      act(() => resizeCallbacks.forEach((cb) => cb()));

      expect(saveButton()).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/se borró la firma/);
      const canvas = padElement() as HTMLCanvasElement;
      expect(canvas.width).toBe(Math.round(800 * Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)));

      // A new signature after the rotation can be saved.
      draw();
      expect(saveButton()).toBeEnabled();
    } finally {
      delete (HTMLCanvasElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it("a resize with an empty pad shows no message", () => {
    let width = 600;
    Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
      configurable: true,
      get: () => width,
    });
    try {
      render(<SignaturePad onSave={vi.fn()} />);
      width = 800;
      act(() => resizeCallbacks.forEach((cb) => cb()));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      delete (HTMLCanvasElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it("disables page scrolling on the pad (touch)", () => {
    render(<SignaturePad onSave={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Área para dibujar la firma" }).className).toMatch(
      /touch-none/,
    );
  });
});
