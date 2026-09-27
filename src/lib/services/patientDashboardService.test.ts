import { describe, expect, it } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import { withBrowserTimeZone } from "../../test/browserTimeZone";
import { fetchMyAppointments } from "./patientDashboardService";

const row = (id: string, startTime: string) => ({
  id,
  service_id: "srv-1",
  start_time: startTime,
  status: "confirmed",
  services: { name: "Valoración", duration_mins: 30 },
});

describe("fetchMyAppointments", () => {
  const stubRows = () =>
    supabaseMock.onFrom("appointments", {
      data: [
        row("morning", "2026-10-15T16:00:00.000Z"), // 10:00 AM in Monterrey
        row("evening", "2026-10-16T02:00:00.000Z"), // 08:00 PM on the 15th in Monterrey
      ],
    });

  const expectClinicLabels = async () => {
    const [morning, evening] = await fetchMyAppointments("p1");
    expect(morning).toMatchObject({ date: "15 oct 2026", time: "10:00 AM" });
    // The UTC date is already the 16th; the patient must still see the 15th.
    expect(evening).toMatchObject({
      date: "15 oct 2026",
      time: "08:00 PM",
      rawDate: "2026-10-16T02:00:00.000Z",
      timestamp: Date.parse("2026-10-16T02:00:00.000Z"),
    });
  };

  it("labels appointments on the clinic's clock", async () => {
    stubRows();
    await expectClinicLabels();
  });

  it("labels them the same for a patient browsing from Chicago in summer", async () => {
    stubRows();
    await withBrowserTimeZone("America/Chicago", expectClinicLabels);
  });
});
