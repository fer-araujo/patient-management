import { test, expect } from "@playwright/test";
import { MISSING_DOCTOR_CREDENTIALS, hasDoctorCredentials } from "./support/env";
import { e2eName } from "./support/testData";
import {
  BUSINESS_TABS,
  gotoBusinessArea,
  gotoCommandCenter,
  gridRow,
  modal,
  openTab,
} from "./support/ui";

/** Administración as the doctor: QA walkthrough steps 9.1 and 10.1-10.2. */
test.describe("Administración (doctor)", () => {
  test.skip(!hasDoctorCredentials(), MISSING_DOCTOR_CREDENTIALS);

  test.beforeEach(async ({ page }) => {
    await gotoCommandCenter(page);
    await gotoBusinessArea(page);
  });

  test("Catálogo: \"Nuevo insumo\" creates an item inside the service form", async ({ page }) => {
    const itemName = e2eName("insumo");
    await openTab(page, BUSINESS_TABS.catalog);

    // A NEW service form, cancelled at the end: the catalog is never changed.
    await page.getByRole("button", { name: "Añadir Tratamiento" }).click();
    const service = modal(page, "Añadir Tratamiento");
    await expect(service).toBeVisible();
    await service.getByRole("button", { name: /^Insumos \(/ }).click();
    await service.getByRole("button", { name: "Nuevo insumo" }).click();

    const inventory = modal(page, "Añadir al Inventario");
    await inventory.getByLabel("Nombre del Artículo").fill(itemName);
    await inventory.getByRole("button", { name: "Crear Artículo" }).click();
    await expect(inventory).toBeHidden();

    // Linked to the service right away, without leaving the form.
    await expect(service.getByText(itemName)).toBeVisible();
    await expect(service.getByRole("button", { name: "Insumos (1)" })).toBeVisible();
    await service.getByRole("button", { name: "Cancelar" }).click();
    await expect(service).toBeHidden();

    // The reset keeps inventory items: archive it so it never shows as active.
    await openTab(page, BUSINESS_TABS.inventory);
    await page.getByPlaceholder("Buscar insumo...").fill(itemName);
    await gridRow(page, itemName).getByRole("button", { name: "Archivar" }).click();
    await expect(page.getByText("Artículo archivado")).toBeVisible();
  });

  test("Finanzas: cash cards and the per-procedure table", async ({ page }) => {
    await openTab(page, BUSINESS_TABS.finances);

    for (const card of ["Ingresos", "Gastos", "Ganancia", "Cortesías"]) {
      await expect(page.getByText(card, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Cobros de consultas")).toBeVisible();
    await expect(page.getByText("Compras de insumos")).toBeVisible();

    // The table (cards on phones) loaded instead of its error message.
    await expect(page.getByText("No se pudo cargar esta tabla.", { exact: false })).toHaveCount(0);
    const procedureCard = page
      .locator("div")
      .filter({ has: page.getByText("Ganancia por procedimiento", { exact: true }) })
      .last();
    await expect(
      procedureCard.locator('table, [data-testid="data-grid-cards"]').first(),
    ).toBeVisible();
  });
});
