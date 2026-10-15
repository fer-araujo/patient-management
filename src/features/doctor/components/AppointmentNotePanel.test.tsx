import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { supabaseMock } from "../../../test/supabaseMock";
import { AppointmentNotePanel } from "./AppointmentNotePanel";

const noteRow = (over: Record<string, unknown> = {}) => ({
  id: "note-1",
  appointment_id: "appt-1",
  patient_id: "patient-1",
  subjective: "Dolor",
  objective: null,
  analysis: null,
  plan: null,
  prognosis: null,
  vital_signs: null,
  created_at: "2026-10-12T16:00:00Z",
  author_id: "doc-1",
  finalized_at: null,
  consultation_finalized_at: "2026-10-12T17:00:00Z",
  recorded_late: false,
  ...over,
});

const renderPanel = () => {
  render(<AppointmentNotePanel appointmentId="appt-1" />);
  return userEvent.setup();
};

describe("AppointmentNotePanel (calendar detail of a completed appointment)", () => {
  it("shows an open note as pending and completes and closes it right there", async () => {
    supabaseMock.onFrom("clinical_notes", { data: noteRow() });
    supabaseMock.onRpc("close_clinical_note", {
      data: { finalized_at: "2026-10-14T18:00:00Z", recorded_late: true },
    });
    const toastSuccess = vi.spyOn(toast, "success");
    const user = renderPanel();

    expect(await screen.findByText("Nota pendiente de cerrar")).toBeInTheDocument();
    expect(supabaseMock.queries("clinical_notes")[0].args("eq")).toEqual([
      "appointment_id",
      "appt-1",
    ]);

    await user.click(screen.getByRole("button", { name: /Completar nota/ }));
    await user.type(screen.getByLabelText("A - Diagnóstico (Análisis)"), "Lumbalgia");
    await user.type(screen.getByLabelText("P - Tratamiento (Plan)"), "Reposo");
    await user.click(screen.getByRole("button", { name: "Cerrar nota" }));
    const buttons = await screen.findAllByRole("button", { name: "Cerrar nota" });
    await user.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(supabaseMock.rpcCalls("close_clinical_note")).toHaveLength(1));
    expect(supabaseMock.lastRpc("close_clinical_note")?.args).toEqual({ p_note_id: "note-1" });
    // Saved through the draft path first (the open note is updated in place).
    const update = supabaseMock.queries("clinical_notes").find((q) => q.has("update"));
    expect(update?.args("update")?.[0]).toMatchObject({ analysis: "Lumbalgia", plan: "Reposo" });
    expect(toastSuccess).toHaveBeenCalledWith("Nota cerrada.");
    expect(await screen.findByText(/^Registrada posteriormente · cerrada el /)).toBeInTheDocument();
    expect(screen.queryByText("Nota pendiente de cerrar")).toBeNull();
  });

  it("says when a closed note was closed, with no editor", async () => {
    supabaseMock.onFrom("clinical_notes", {
      data: noteRow({ finalized_at: "2026-10-12T18:00:00Z", analysis: "Sano", plan: "Alta" }),
    });
    renderPanel();

    expect(await screen.findByText(/^Nota cerrada el /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Completar nota/ })).toBeNull();
  });

  it("renders nothing for an appointment without a note", async () => {
    const { container } = render(<AppointmentNotePanel appointmentId="appt-1" />);

    await waitFor(() => expect(supabaseMock.queries("clinical_notes")).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});
