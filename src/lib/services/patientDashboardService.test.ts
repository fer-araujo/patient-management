import { describe, expect, it } from "vitest";
import { supabaseMock } from "../../test/supabaseMock";
import { withBrowserTimeZone } from "../../test/browserTimeZone";
import { fetchMyAppointments, fetchMyCarePlan } from "./patientDashboardService";

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

describe("fetchMyCarePlan", () => {
  it("shows an old item, a structured item and a whitespace-only item sensibly", async () => {
    supabaseMock.onFrom("prescriptions", {
      data: {
        medications: [
          // Written before migration 25.
          { nombre: "Ibuprofeno", dosis: "400 mg", indicaciones: "1 tableta cada 8 h" },
          // Structured (migration 25).
          {
            nombre: "Amoxicilina",
            presentacion: "Cápsulas 500 mg",
            dosis: "1 cápsula",
            via: "Oral",
            frecuencia: "Cada 8 h",
            duracion: "7 días",
            indicaciones: "Con alimentos",
          },
          // Only blanks.
          { nombre: "  ", dosis: " ", via: " ", frecuencia: "  ", duracion: " ", indicaciones: "   " },
        ],
      },
    });

    const [old, structured, blank] = await fetchMyCarePlan("p1");

    expect(old).toMatchObject({
      name: "Ibuprofeno (400 mg)",
      instruction: "1 tableta cada 8 h",
      daysLeft: "Continuo",
    });
    expect(structured).toMatchObject({
      name: "Amoxicilina (1 cápsula)",
      instruction: "Cada 8 h · Vía oral · Con alimentos",
      daysLeft: "7 días",
    });
    expect(blank).toMatchObject({
      name: "Tratamiento / Medicamento",
      instruction: "Ver indicaciones de la doctora",
      daysLeft: "Continuo",
    });
  });
});
