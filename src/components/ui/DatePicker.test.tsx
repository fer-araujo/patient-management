import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DatePicker } from "./DatePicker";

const pickerProps = {
  onClose: () => {},
  selectedDate: "1960-04-12",
  onSelectDate: () => {},
  allowPast: true,
  maxDate: "2026-09-25",
  title: "Fecha de nacimiento",
};

// The picker jumps to the selected month when it goes from closed to open,
// exactly as it happens in the app, so tests mount it closed and then open it.
const renderOpened = (
  wrap: (node: React.ReactNode) => React.ReactNode,
  selectedDate = pickerProps.selectedDate,
) => {
  const props = { ...pickerProps, selectedDate };
  const view = render(wrap(<DatePicker isOpen={false} {...props} />));
  view.rerender(wrap(<DatePicker isOpen {...props} />));
  return view;
};

// Regression: the picker is used inside forms (e.g. the patient edit modal).
// A <button> without type="button" defaults to "submit", so navigating
// months used to submit and save the surrounding form.
describe("DatePicker inside a form", () => {
  it("never submits the surrounding form while navigating or cancelling", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    renderOpened((node) => <form onSubmit={onSubmit}>{node}</form>);

    // Every button rendered by the picker (and its Modal) is a plain button.
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
    }

    await user.click(screen.getByText("Abril 1960"));
    await user.click(screen.getByText("Cancelar"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("goes year -> month -> day, reaching past years for a birth date", async () => {
    const user = userEvent.setup();
    renderOpened((node) => node);

    expect(screen.getByText("Fecha de nacimiento")).toBeInTheDocument();
    // Calendar header -> year grid.
    await user.click(screen.getByText("Abril 1960"));
    // Picking a year opens the month grid, not the day calendar.
    await user.click(screen.getByRole("button", { name: "1957" }));
    expect(screen.getByRole("button", { name: "Mar" })).toBeEnabled();
    // Picking a month opens that month's days.
    await user.click(screen.getByRole("button", { name: "Mar" }));
    expect(screen.getByText("Marzo 1957")).toBeInTheDocument();
  });

  it("disables months entirely after the max date", async () => {
    const user = userEvent.setup();
    renderOpened((node) => node, "2026-04-12");

    await user.click(screen.getByText("Abril 2026"));
    await user.click(screen.getByRole("button", { name: "2026" }));
    // maxDate is 2026-09-25: September is still pickable, October is not.
    expect(screen.getByRole("button", { name: "Sep" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Oct" })).toBeDisabled();
  });
});
