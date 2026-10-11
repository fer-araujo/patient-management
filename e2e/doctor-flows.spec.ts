import { test, expect, type Locator, type Page } from "@playwright/test";
import { MISSING_DOCTOR_CREDENTIALS, hasDoctorCredentials } from "./support/env";
import { clinicApiFor } from "./support/supabaseApi";
import { newTestPatient, type TestPatient } from "./support/testData";
import {
  CLINICAL_TABS,
  appointmentBlock,
  bookFromCalendar,
  chooseOption,
  gotoCommandCenter,
  gridRow,
  modal,
  openCalendarDay,
  openTab,
} from "./support/ui";

/**
 * The doctor's critical paths of docs/qa-walkthrough.md (steps 3, 4, 5, 6.3
 * and 8), on ONE patient created by the first test. Serial: a failure skips
 * the rest, which depend on that patient.
 */
test.describe.configure({ mode: "serial" });

test.describe("Doctor critical paths", () => {
  test.skip(!hasDoctorCredentials(), MISSING_DOCTOR_CREDENTIALS);

  let patient: TestPatient | undefined;

  const requirePatient = (): TestPatient => {
    if (!patient) throw new Error("The Directorio test did not create the test patient.");
    return patient;
  };

  /**
   * Books the patient from the calendar UI. "Buscar Paciente" and "Servicio a
   * realizar" list the patient directory and the active catalog (not the
   * existing appointments), so the brand-new patient is offered right away.
   */
  const bookForPatient = async (page: Page, p: TestPatient) => {
    const api = await clinicApiFor(page);
    const service = await api.bookableService();
    const plan = await api.planFreeDay(service.duration_mins);
    await openTab(page, CLINICAL_TABS.calendar);
    await openCalendarDay(page, plan.dayOffset);
    await bookFromCalendar(page, {
      patientName: p.fullName,
      patientSearch: p.firstName,
      serviceName: service.name,
      slot: plan.first,
    });
    return plan;
  };

  test.beforeEach(async ({ page }) => {
    await gotoCommandCenter(page);
  });

  test("Directorio: new patient with the paper privacy notice", async ({ page }) => {
    const p = newTestPatient(test.info().project.name);

    await openTab(page, CLINICAL_TABS.patients);
    await page.getByRole("button", { name: "+ Nuevo Paciente" }).click();
    const dialog = modal(page, "Nuevo Paciente");
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Ej. María").fill(p.firstName);
    await dialog.getByPlaceholder("Ej. González").fill(p.lastName);
    await dialog.getByPlaceholder("10 dígitos").fill(p.phone);
    // The real checkbox is visually hidden; the row (its label) is the target.
    const consentText = "El paciente firmó el aviso de privacidad en papel";
    await dialog.getByText(consentText).click();
    await expect(dialog.getByLabel(consentText)).toBeChecked();
    await dialog.getByRole("button", { name: "Crear Expediente" }).click();
    await expect(dialog).toBeHidden();

    await page.getByPlaceholder("Buscar expediente...").fill(p.firstName);
    const row = gridRow(page, p.firstName);
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Aviso firmado", { exact: true })).toBeVisible();

    patient = p;
  });

  test("Calendario: book, reschedule and cancel an appointment", async ({ page }) => {
    const p = requirePatient();
    const plan = await bookForPatient(page, p);
    const block = appointmentBlock(page, p.fullName);

    await test.step("reschedule to another free hour", async () => {
      await block.click();
      await modal(page, "Detalles de la Cita").getByRole("button", { name: "Reprogramar" }).click();
      const reschedule = modal(page, "Reprogramar Cita");
      await chooseOption(
        page,
        reschedule.getByRole("combobox", { name: "Nueva Hora" }),
        plan.second.label,
      );
      await reschedule.getByRole("button", { name: "Confirmar Reprogramación" }).click();
      await expect(reschedule).toBeHidden();
    });

    await test.step("it shows at the new time", async () => {
      await block.click();
      const details = modal(page, "Detalles de la Cita");
      await expect(details).toContainText(`${plan.second.label} (`);
      await details.getByRole("button", { name: "Cancelar Cita" }).click();
    });

    await test.step("cancel it", async () => {
      const cancel = modal(page, "Cancelar Cita");
      await cancel
        .getByPlaceholder("Ej: El paciente avisó que no podía asistir...")
        .fill("E2E: prueba automatizada");
      await cancel.getByRole("button", { name: "Confirmar Cancelación" }).click();
      await expect(cancel).toBeHidden();
      await expect(block).toHaveCount(0);
    });
  });

  test("Consulta: record, prescription and courtesy finalization", async ({ page }) => {
    const p = requirePatient();
    await bookForPatient(page, p);

    await appointmentBlock(page, p.fullName).click();
    await modal(page, "Detalles de la Cita").getByRole("button", { name: "Iniciar" }).click();
    await expect(page.getByRole("heading", { name: "Consulta Activa" })).toBeVisible();
    // Locked until the saved draft (if any) is loaded.
    await expect(page.getByLabel("S - Motivo y Síntomas")).toBeEnabled();

    await test.step("antecedentes (open by themselves on a first visit)", async () => {
      await page.getByLabel("Alergias", { exact: true }).fill("Penicilina (E2E)");
      await page.getByLabel("Enfermedades crónicas", { exact: true }).fill("Negadas (E2E)");
    });

    await test.step("vital signs", async () => {
      await page.getByLabel("Presión sistólica").fill("120");
      await page.getByLabel("Presión diastólica").fill("80");
      await page.getByLabel("Oxigenación").fill("98");
      await page.getByLabel("Peso", { exact: true }).fill("70.5");
      await page.getByLabel("Talla", { exact: true }).fill("165");
    });

    await test.step("SOAP note and prognosis", async () => {
      await page.getByLabel("S - Motivo y Síntomas").fill("E2E: revisión de rutina.");
      await page.getByLabel("O - Exploración Física").fill("E2E: sin hallazgos.");
      await page.getByLabel("A - Diagnóstico (Análisis)").fill("E2E: paciente sano.");
      await page.getByLabel("Pronóstico", { exact: true }).fill("Favorable");
      await page.getByLabel("P - Tratamiento (Plan)").fill("E2E: revisión en 6 meses.");
    });

    const medicationName = `Paracetamol E2E ${p.firstName.slice(-6)}`;
    await test.step("structured medication", async () => {
      await page.getByRole("button", { name: "Recetas e Indicaciones" }).click();
      await page.getByRole("button", { name: "Nueva Indicación" }).click();
      const form = modal(page, "Nueva Indicación Médica");
      await form.getByLabel("Medicamento (nombre genérico)").fill(medicationName);
      await form.getByLabel("Presentación").fill("Tabletas de 500 mg");
      await form.getByLabel("Dosis").fill("1 tableta");
      await chooseOption(page, form.getByRole("combobox", { name: /Vía/ }), "Oral");
      await form.getByLabel("Frecuencia").fill("Cada 8 horas");
      await form.getByLabel("Duración").fill("3 días");
      await form.getByLabel("Indicaciones").fill("Tomar con alimentos");
      await form.getByRole("button", { name: "Añadir a la Receta" }).click();
      await expect(form).toBeHidden();
      await expect(page.getByText(medicationName).first()).toBeVisible();
    });

    await test.step("finalize as a courtesy with no supplies", async () => {
      // "Finalizar Consulta"; phones show "Finalizar" only.
      await page.getByRole("button", { name: /^Finalizar/ }).click();
      const charge = modal(page, "Cobro de la consulta");
      await charge.getByRole("radio", { name: "No cobré (cortesía)" }).click();
      await expect(charge.getByText("Cargando insumos...")).toBeHidden();
      await removeEverySupply(charge);
      await charge.getByRole("button", { name: "Guardar y finalizar" }).click();

      const finished = modal(page, "Consulta finalizada");
      await expect(finished).toBeVisible({ timeout: 20_000 });
      await expect(finished.getByRole("listitem").filter({ hasText: medicationName })).toBeVisible();
      await finished.getByRole("button", { name: "Listo" }).click();
      await expect(finished).toBeHidden();
      await expect(page.getByRole("heading", { name: "Centro de Comando" })).toBeVisible();
    });
  });

  test("Control de peso: turn it on and add a measurement", async ({ page }) => {
    const p = requirePatient();

    await openTab(page, CLINICAL_TABS.patients);
    await page.getByPlaceholder("Buscar expediente...").fill(p.firstName);
    await gridRow(page, p.firstName).getByRole("button", { name: "Ver Expediente" }).click();
    await expect(page.getByRole("heading", { name: "Revisión de Expediente" })).toBeVisible();

    await page.getByRole("button", { name: "Llevar control de peso" }).click();
    const confirm = modal(page, "Control de peso");
    await confirm.getByRole("button", { name: "Sí, llevar control" }).click();
    await expect(confirm).toBeHidden();

    await page.getByRole("button", { name: "Nueva medición" }).click();
    const form = modal(page, "Nueva medición");
    await form.getByLabel("Peso (kg)").fill("71.3");
    await form.getByLabel("Talla (cm)").fill("165");
    await form.getByRole("button", { name: "Guardar medición" }).click();
    await expect(form).toBeHidden();

    const latest = page.getByRole("region", { name: "Última medición" });
    await expect(latest).toBeVisible();
    await expect(latest).toContainText("71.3");
    const history = page.getByRole("region", { name: "Historial", exact: true });
    await expect(gridRow(history, "71.3")).toHaveCount(1);

    // Review mode: the back arrow closes the record.
    await page.getByRole("button", { name: "Guardar borrador y volver" }).click();
    await page.getByPlaceholder("Buscar expediente...").fill(p.firstName);
    await expect(
      gridRow(page, p.firstName).getByText("Control de peso", { exact: true }),
    ).toBeVisible();
  });
});

/** Empties "Insumos usados" of the charge step (the service's suggestions). */
const removeEverySupply = async (charge: Locator) => {
  const removeButtons = charge.getByRole("button", { name: /^Quitar / });
  for (let guard = 0; guard < 50 && (await removeButtons.count()) > 0; guard++) {
    await removeButtons.first().click();
  }
  await expect(removeButtons).toHaveCount(0);
};
