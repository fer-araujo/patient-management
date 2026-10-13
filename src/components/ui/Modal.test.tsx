import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

afterEach(() => {
  // Unmount first, so every modal releases the shared scroll lock, then
  // reset what a failed assertion may have left behind.
  cleanup();
  document.body.style.overflow = "";
});

describe("Modal", () => {
  it("locks the page scroll while open and restores it when closed", () => {
    document.body.style.overflow = "auto";
    const view = render(
      <Modal isOpen={false} onClose={() => {}} title="Detalle">
        Contenido
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("auto");

    view.rerender(
      <Modal isOpen onClose={() => {}} title="Detalle">
        Contenido
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(
      <Modal isOpen={false} onClose={() => {}} title="Detalle">
        Contenido
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("auto");
  });

  it("keeps the page locked until the last of two stacked modals closes", () => {
    const stacked = (inner: boolean) => (
      <>
        <Modal isOpen onClose={() => {}} title="Formulario">
          Formulario
        </Modal>
        <Modal isOpen={inner} onClose={() => {}} title="Fecha">
          Calendario
        </Modal>
      </>
    );
    const view = render(stacked(true));
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(stacked(false));
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("names the icon-only close button and closes with it", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal isOpen onClose={onClose} title="Detalle">
        Contenido
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Cerrar ventana" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes only the top-most of two stacked modals", async () => {
    const user = userEvent.setup();
    const closeForm = vi.fn();
    const closeTop = vi.fn();
    const stacked = (topOpen: boolean) => (
      <>
        <Modal isOpen onClose={closeForm} title="Formulario">
          Formulario
        </Modal>
        <Modal isOpen={topOpen} onClose={closeTop} title="Nuevo">
          Nuevo
        </Modal>
      </>
    );
    const view = render(stacked(true));

    await user.keyboard("{Escape}");
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeForm).not.toHaveBeenCalled();

    // Once the top one is gone, Escape reaches the one below.
    view.rerender(stacked(false));
    await user.keyboard("{Escape}");
    expect(closeForm).toHaveBeenCalledTimes(1);
    expect(closeTop).toHaveBeenCalledTimes(1);

    // Nothing listens once every modal is closed.
    view.unmount();
    await user.keyboard("{Escape}");
    expect(closeForm).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape that ends IME composition or that a field already handled", () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Detalle">
        <input aria-label="Nombre" />
      </Modal>,
    );
    const field = screen.getByRole("textbox", { name: "Nombre" });

    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();

    field.addEventListener("keydown", (e) => e.preventDefault(), {
      once: true,
    });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression (iPad): a modal opened from inside another one (the
  // DatePicker in a form) rendered inside the parent's overflow-hidden panel,
  // and iPad Safari clipped the wider calendar on both sides.
  it("renders into <body>, outside the panel of the modal it was opened from", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Formulario">
        <div data-testid="form-body">
          <Modal isOpen onClose={() => {}} title="Fecha">
            Calendario
          </Modal>
        </div>
      </Modal>,
    );

    const formBody = screen.getByTestId("form-body");
    const inner = screen.getByText("Calendario");
    expect(formBody).not.toContainElement(inner);
    expect(inner.closest(".fixed")?.parentElement).toBe(document.body);
  });

  describe("tablet width (touch, 768-1279 px)", () => {
    const panelOf = (maxWidth?: string) => {
      render(
        <Modal isOpen onClose={() => {}} title="Detalle" maxWidth={maxWidth}>
          Contenido
        </Modal>,
      );
      return screen.getByText("Contenido").closest(".rounded-4xl")!;
    };

    it("widens regular modals to min(720px, 92vw) and keeps the desktop width", () => {
      const panel = panelOf("max-w-lg");
      expect(panel).toHaveClass("max-w-lg", "w-full");
      expect(panel).toHaveClass("md:max-xl:pointer-coarse:max-w-[min(720px,92vw)]");
    });

    it("widens the default size too", () => {
      expect(panelOf()).toHaveClass(
        "max-w-2xl",
        "md:max-xl:pointer-coarse:max-w-[min(720px,92vw)]",
      );
    });

    it("keeps compact modals a bit narrower", () => {
      expect(panelOf("max-w-md")).toHaveClass(
        "max-w-md",
        "md:max-xl:pointer-coarse:max-w-[min(600px,92vw)]",
      );
    });

    it("leaves modals already wider than a tablet column alone", () => {
      const panel = panelOf("max-w-5xl");
      expect(panel).toHaveClass("max-w-5xl");
      expect(panel.className).not.toContain("pointer-coarse:max-w-");
    });

    it("keeps phones nearly full screen", () => {
      expect(panelOf("max-w-lg")).toHaveClass("max-md:max-h-[94vh]");
    });
  });
});
