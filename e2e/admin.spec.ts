import { test, expect } from "@playwright/test";
import { MISSING_ADMIN_CREDENTIALS, hasAdminCredentials } from "./support/env";
import { BUSINESS_TABS, businessHeading, openTab } from "./support/ui";

/** QA walkthrough 10.4: the admin account only sees Administración. */
test.describe("Admin account", () => {
  test.skip(!hasAdminCredentials(), MISSING_ADMIN_CREDENTIALS);

  test("is sent to Administración and sees Finanzas without patient names", async ({ page }) => {
    // Centro Clínico is the doctor's only.
    await page.goto("/doctor/dashboard");
    await expect(page).toHaveURL(/\/doctor\/admin$/);
    await expect(businessHeading(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Centro Clínico" })).toHaveCount(0);

    await openTab(page, BUSINESS_TABS.finances);
    await expect(page.getByText("Ingresos", { exact: true }).first()).toBeVisible();

    // For the doctor a charge reads "Servicio · Paciente"; for the admin only
    // the service. No concept may carry a name, and no e2e patient may show.
    await expect(page.getByText(/ · /)).toHaveCount(0);
    await expect(page.getByText(/E2E-\d+/)).toHaveCount(0);
  });
});
