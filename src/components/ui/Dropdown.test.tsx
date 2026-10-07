import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dropdown } from "./Dropdown";
import { Modal } from "./Modal";

const options = [
  { label: "Oral", value: "oral" },
  { label: "Tópica", value: "topica" },
];

const renderDropdown = (searchable = false) =>
  render(
    <>
      <p>Fuera del menú</p>
      <Dropdown
        options={options}
        value=""
        onChange={() => {}}
        searchable={searchable}
      />
    </>,
  );

/** Puts the trigger at `top`..`bottom` px in a 1000 px tall window. */
const placeTrigger = (top: number, bottom: number) => {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
    left: 20,
    right: 220,
    width: 200,
    height: bottom - top,
    x: 20,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
};

const menuBox = () =>
  screen.getByRole("listbox").closest("[data-placement]") as HTMLElement;

const setCoarsePointer = (coarse: boolean) => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: coarse && query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Dropdown", () => {
  it("closes on a pointerdown outside (a tap on iPad), not only on mousedown", async () => {
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // A touch tap fires pointer events; iPad Safari may skip mousedown.
    fireEvent.pointerDown(screen.getByText("Fuera del menú"));
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("stays open when the press lands inside the menu", async () => {
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole("combobox"));
    fireEvent.pointerDown(screen.getByRole("option", { name: "Oral" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("opens below the trigger when there is room", async () => {
    placeTrigger(100, 140);
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole("combobox"));
    expect(menuBox()).toHaveAttribute("data-placement", "below");
    expect(menuBox().style.transform).toBe("");
  });

  it("flips above the trigger near the bottom of the screen", async () => {
    placeTrigger(900, 940);
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole("combobox"));
    expect(menuBox()).toHaveAttribute("data-placement", "above");
    expect(menuBox().style.transform).toBe("translateY(-100%)");
  });

  it("measures the visual viewport, which shrinks when the iOS keyboard opens", async () => {
    // Trigger at 500 px: plenty of room in the window, but the keyboard
    // leaves only 600 px visible.
    placeTrigger(500, 540);
    vi.stubGlobal("visualViewport", {
      height: 600,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole("combobox"));
    expect(menuBox()).toHaveAttribute("data-placement", "above");
  });

  it("Escape inside a Modal closes only the open list, then the modal", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal isOpen onClose={onClose} title="Formulario">
        <Dropdown options={options} value="" onChange={() => {}} />
      </Modal>,
    );

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(onClose).not.toHaveBeenCalled();

    // With the list closed, Escape reaches the modal again.
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the search box with a mouse but not on a touch screen", async () => {
    const user = userEvent.setup();

    setCoarsePointer(false);
    const desktop = renderDropdown(true);
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("textbox", { name: "Buscar opción" })).toHaveFocus();
    desktop.unmount();

    // On iPad the keyboard would cover the options.
    setCoarsePointer(true);
    renderDropdown(true);
    await user.click(screen.getByRole("combobox"));
    expect(
      screen.getByRole("textbox", { name: "Buscar opción" }),
    ).not.toHaveFocus();
  });
});
