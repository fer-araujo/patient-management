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
});
