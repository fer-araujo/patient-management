// The decision lives next to the Deno edge function (it is deployed with it)
// but is pure TypeScript with no Deno API, so the Vitest suite covers it here.
import { describe, expect, it } from "vitest";
import {
  decideNotification,
  type AppointmentEvent,
} from "../../../supabase/functions/notify-appointment/notificationDecision.ts";

const START = "2026-10-20T15:00:00+00:00";
const OTHER_START = "2026-10-21T16:30:00+00:00";

const update = (
  oldRecord: Record<string, unknown>,
  record: Record<string, unknown>,
): AppointmentEvent => ({
  type: "UPDATE",
  old_record: { start_time: START, ...oldRecord },
  record: { start_time: START, ...record },
});

describe("decideNotification", () => {
  describe("INSERT", () => {
    it("announces an appointment the clinic booked as confirmed", () => {
      expect(
        decideNotification({ type: "INSERT", record: { status: "confirmed", start_time: START } }),
      ).toBe("booked_confirmed");
    });

    it("acknowledges an online request that is pending", () => {
      expect(
        decideNotification({ type: "INSERT", record: { status: "pending", start_time: START } }),
      ).toBe("request_received");
    });

    it.each(["completed", "cancelled", "rejected"])(
      "sends nothing for a row inserted as %s",
      (status) => {
        expect(decideNotification({ type: "INSERT", record: { status, start_time: START } })).toBeNull();
      },
    );
  });

  describe("UPDATE that changes the status", () => {
    it("sends the cancellation when the status becomes cancelled", () => {
      expect(decideNotification(update({ status: "confirmed" }, { status: "cancelled" }))).toBe("cancelled");
      expect(decideNotification(update({ status: "pending" }, { status: "cancelled" }))).toBe("cancelled");
    });

    it("sends the confirmation when a pending request is confirmed", () => {
      expect(decideNotification(update({ status: "pending" }, { status: "confirmed" }))).toBe("confirmed");
    });

    it.each(["completed", "rejected"])("sends nothing when the status becomes %s", (status) => {
      expect(decideNotification(update({ status: "confirmed" }, { status }))).toBeNull();
    });

    it("prefers the cancellation when the start time changes in the same update", () => {
      expect(
        decideNotification(update({ status: "confirmed" }, { status: "cancelled", start_time: OTHER_START })),
      ).toBe("cancelled");
    });
  });

  describe("UPDATE that changes the start time", () => {
    it("sends the reschedule when a patient moves a confirmed visit (back to pending)", () => {
      expect(
        decideNotification(update({ status: "confirmed" }, { status: "pending", start_time: OTHER_START })),
      ).toBe("rescheduled");
    });

    it("sends the reschedule when the clinic moves a visit and keeps it confirmed", () => {
      expect(
        decideNotification(update({ status: "confirmed" }, { status: "confirmed", start_time: OTHER_START })),
      ).toBe("rescheduled");
    });

    it("prefers the reschedule (it carries the new date) over the confirmation", () => {
      expect(
        decideNotification(update({ status: "pending" }, { status: "confirmed", start_time: OTHER_START })),
      ).toBe("rescheduled");
    });

    it("sends nothing when a cancelled or completed row is moved", () => {
      expect(
        decideNotification(update({ status: "cancelled" }, { status: "cancelled", start_time: OTHER_START })),
      ).toBeNull();
      expect(
        decideNotification(update({ status: "completed" }, { status: "completed", start_time: OTHER_START })),
      ).toBeNull();
    });

    it("treats two spellings of the same instant as unchanged", () => {
      expect(
        decideNotification(
          update({ status: "confirmed" }, { status: "confirmed", start_time: "2026-10-20T15:00:00Z" }),
        ),
      ).toBeNull();
    });
  });

  describe("UPDATE that changes neither status nor start time", () => {
    it.each(["confirmed", "cancelled", "pending"])(
      "sends nothing for a bookkeeping change on a %s row",
      (status) => {
        expect(
          decideNotification(update({ status, notes: "a" }, { status, notes: "b", patient_reschedule_count: 1 })),
        ).toBeNull();
      },
    );
  });

  describe("events that cannot prove a change", () => {
    it("sends nothing for an UPDATE without old_record", () => {
      expect(decideNotification({ type: "UPDATE", record: { status: "confirmed", start_time: START } })).toBeNull();
    });

    it("sends nothing for a DELETE or an unknown event", () => {
      expect(decideNotification({ type: "DELETE", record: { status: "confirmed", start_time: START } })).toBeNull();
      expect(decideNotification({ type: "TRUNCATE", record: null })).toBeNull();
    });

    it("sends nothing without a record", () => {
      expect(decideNotification({ type: "INSERT", record: null })).toBeNull();
    });
  });
});
