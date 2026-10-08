import { test, expect } from "@playwright/test";
import { MISSING_DOCTOR_CREDENTIALS, hasDoctorCredentials } from "./support/env";
import {
  BUSINESS_TABS,
  CLINICAL_TABS,
  commandCenterHeading,
  expectNoHorizontalOverflow,
  gotoBusinessArea,
  gotoCommandCenter,
  openTab,
} from "./support/ui";

/** QA walkthrough 1.1 and 14: the doctor's sections fit every screen. */
test.describe("Doctor navigation", () => {
  test.skip(!hasDoctorCredentials(), MISSING_DOCTOR_CREDENTIALS);

  test("Centro de Comando opens and no main tab scrolls sideways", async ({ page }) => {
    await gotoCommandCenter(page);
    await expect(commandCenterHeading(page)).toBeVisible();

    for (const tab of Object.values(CLINICAL_TABS)) {
      await test.step(`Centro Clínico › ${tab.label}`, async () => {
        await openTab(page, tab);
        await expectNoHorizontalOverflow(page, tab.label);
      });
    }

    await gotoBusinessArea(page);
    for (const tab of Object.values(BUSINESS_TABS)) {
      await test.step(`Administración › ${tab.label}`, async () => {
        await openTab(page, tab);
        await expectNoHorizontalOverflow(page, tab.label);
      });
    }
  });
});
