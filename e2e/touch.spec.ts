import { test, expect } from "@playwright/test";
import { MISSING_DOCTOR_CREDENTIALS, hasDoctorCredentials } from "./support/env";
import { CLINICAL_TABS, gotoCommandCenter, modal, openTab } from "./support/ui";

/**
 * Finger-only checks for the iPad and iPhone projects: everything here uses
 * tap(), never a mouse click. Nothing is saved.
 */
test.describe("Touch screens", () => {
  test.skip(!hasDoctorCredentials(), MISSING_DOCTOR_CREDENTIALS);
  test.skip(({ hasTouch }) => !hasTouch, "Touch-only checks run on the ipad and iphone projects.");

  test.beforeEach(async ({ page }) => {
    await gotoCommandCenter(page);
    await openTab(page, CLINICAL_TABS.patients);
  });

  test("a Dropdown opens and closes by tap", async ({ page }) => {
    await page.getByRole("button", { name: "+ Nuevo Paciente" }).tap();
    const dialog = modal(page, "Nuevo Paciente");
    await expect(dialog).toBeVisible();

    const gender = dialog.getByRole("combobox", { name: "Género" });
    const list = page.getByRole("listbox");

    // Tap an option: it is chosen and the list closes.
    await gender.tap();
    await expect(list).toBeVisible();
    await expect(gender).toHaveAttribute("aria-expanded", "true");
    await list.getByRole("option", { name: "Femenino", exact: true }).tap();
    await expect(list).toBeHidden();
    await expect(gender).toContainText("Femenino");

    // Tap outside the list: it closes (iPad Safari, pointerdown).
    await gender.tap();
    await expect(list).toBeVisible();
    await dialog.getByRole("heading", { name: "Nuevo Paciente", exact: true }).tap();
    await expect(list).toBeHidden();
    await expect(gender).toHaveAttribute("aria-expanded", "false");

    // Leave without creating anything.
    await dialog.getByRole("button", { name: "Cancelar" }).tap();
    await expect(dialog).toBeHidden();
  });

  test("a Modal closes with its close button", async ({ page }) => {
    await page.getByRole("button", { name: "+ Nuevo Paciente" }).tap();
    const dialog = modal(page, "Nuevo Paciente");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar ventana" }).tap();
    await expect(dialog).toBeHidden();
  });

  test("the iPhone directory shows cards instead of a table", async ({ page }) => {
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width >= 768, "Phones only (below 768 px): tablets keep the table.");

    await expect(page.getByTestId("data-grid-cards")).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });
});
