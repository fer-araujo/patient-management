import { expect, type Locator, type Page } from "@playwright/test";
import type { Credentials } from "./env";
import type { Slot } from "./schedule";

/**
 * Page helpers shared by the specs. They query by role, label and visible
 * text, like the unit tests. The few structural selectors are explained
 * where they are used.
 */

// ---------------------------------------------------------------------------
// Sign-in and areas
// ---------------------------------------------------------------------------

/** The staff sign-in form (AdminLogin). Never logs the values. */
export const signIn = async (page: Page, credentials: Credentials) => {
  await page.getByLabel("Correo corporativo").fill(credentials.email);
  await page.getByLabel("Contraseña").fill(credentials.password);
  await page.getByRole("button", { name: /Iniciar Sesión/ }).click();
};

export const commandCenterHeading = (page: Page) =>
  page.getByRole("heading", { name: "Centro de Comando" });

export const businessHeading = (page: Page) =>
  page.getByRole("heading", { name: "Gestión del Negocio" });

/** Opens Centro Clínico and waits until the appointments are loaded. */
export const gotoCommandCenter = async (page: Page) => {
  await page.goto("/doctor/dashboard");
  await expect(commandCenterHeading(page)).toBeVisible();
};

/** Header button "Administración" (Catálogo, Inventario, Finanzas). */
export const gotoBusinessArea = async (page: Page) => {
  await page.getByRole("button", { name: "Administración" }).click();
  await expect(page).toHaveURL(/\/doctor\/admin$/);
  await expect(businessHeading(page)).toBeVisible();
};

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface TabDef {
  /** Readable name for failure messages. */
  label: string;
  /** Accessible name; phones hide part of some labels. */
  name: RegExp;
  /** Resolves once the tab's content has loaded. */
  ready: (page: Page) => Promise<void>;
}

const placeholderVisible = (placeholder: string) => async (page: Page) => {
  await expect(page.getByPlaceholder(placeholder, { exact: true })).toBeVisible();
};

export const CLINICAL_TABS = {
  inbox: {
    label: "Agenda",
    name: /^Agenda$/,
    ready: placeholderVisible("Buscar paciente o servicio..."),
  },
  patients: {
    label: "Pacientes",
    name: /Pacientes$/,
    ready: async (page) => {
      await expect(page.getByPlaceholder("Buscar expediente...")).toBeVisible();
      await expect(page.getByText("Cargando expedientes...")).toBeHidden();
    },
  },
  calendar: {
    label: "Calendario",
    name: /^Calendario$/,
    ready: async (page) => {
      await expect(page.getByRole("button", { name: "Ir a hoy" })).toBeVisible();
    },
  },
  arco: {
    label: "Solicitudes",
    name: /^Solicitudes/,
    ready: async (page) => {
      await expect(page.getByText("Cargando solicitudes...")).toBeHidden();
      await expect(page.getByPlaceholder("Buscar paciente...", { exact: true })).toBeVisible();
    },
  },
  audit: {
    label: "Bitácora",
    name: /^Bitácora$/,
    ready: async (page) => {
      await expect(page.getByLabel("Cargando", { exact: true })).toHaveCount(0);
    },
  },
} satisfies Record<string, TabDef>;

export const BUSINESS_TABS = {
  catalog: {
    label: "Catálogo",
    name: /^Catálogo/,
    ready: placeholderVisible("Buscar tratamiento..."),
  },
  inventory: {
    label: "Inventario",
    name: /^Inventario/,
    ready: placeholderVisible("Buscar insumo..."),
  },
  finances: {
    label: "Finanzas",
    name: /^Finanzas/,
    ready: async (page) => {
      await expect(page.getByText("Cargando finanzas...")).toBeHidden();
      await expect(page.getByText("Ganancia por procedimiento", { exact: true })).toBeVisible();
    },
  },
} satisfies Record<string, TabDef>;

export const openTab = async (page: Page, tab: TabDef) => {
  await page.getByRole("button", { name: tab.name }).click();
  await tab.ready(page);
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** The page must never scroll sideways (iPad / iPhone review, QA step 14). */
export const expectNoHorizontalOverflow = async (page: Page, where: string) => {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    scrollWidth,
    `${where}: the page is ${scrollWidth}px wide in a ${innerWidth}px viewport`,
  ).toBeLessThanOrEqual(innerWidth);
};

// ---------------------------------------------------------------------------
// Modals, dropdowns and grids
// ---------------------------------------------------------------------------

/**
 * An open Modal, found by its title. Modal.tsx renders no dialog role, so this
 * is the full-screen wrapper (`fixed inset-0`) that holds the title heading.
 */
export const modal = (page: Page, title: string) =>
  page
    .locator("div.fixed.inset-0")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

/**
 * Picks an option of a Dropdown. The list is portaled to <body>, so it is
 * looked up on the page, not inside the modal. `search` types in the
 * dropdown's own search box first (searchable dropdowns only).
 */
export const chooseOption = async (
  page: Page,
  combobox: Locator,
  option: string,
  search?: string,
) => {
  await combobox.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  if (search !== undefined) {
    await page.getByLabel("Buscar opción").fill(search);
  }
  await listbox.getByRole("option", { name: option, exact: true }).click();
  await expect(listbox).toBeHidden();
};

/**
 * A DataGrid row with `text`: a table row on tablets and desktops, a card
 * (data-testid="data-grid-card") on phones.
 */
export const gridRow = (scope: Page | Locator, text: string) =>
  scope.locator('tr, [data-testid="data-grid-card"]').filter({ hasText: text });

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** Día view on the clinic's today + `dayOffset`. */
export const openCalendarDay = async (page: Page, dayOffset: number) => {
  await page.getByRole("button", { name: "Día", exact: true }).click();
  await page.getByRole("button", { name: "Ir a hoy" }).click();
  for (let i = 0; i < dayOffset; i++) {
    await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  }
};

/**
 * The free-hour cell of the Día view. Its label "+ Agendar o Bloquear 10:00 AM"
 * is hidden on touch screens, but it is always in the DOM: the cell is the
 * innermost div that contains it (the last one in document order).
 */
const emptyHourCell = (page: Page, slot: Slot) =>
  page
    .locator("div")
    .filter({ has: page.getByText(`+ Agendar o Bloquear ${slot.label}`, { exact: true }) })
    .last();

/** An appointment in the Día view (its title is the patient's name). */
export const appointmentBlock = (page: Page, patientName: string) =>
  page.getByRole("heading", { level: 4, name: patientName, exact: true });

/** "Gestión de Agenda" -> "Agendar Cita" from an empty hour of the Día view. */
export const bookFromCalendar = async (
  page: Page,
  booking: { patientName: string; patientSearch: string; serviceName: string; slot: Slot },
) => {
  await emptyHourCell(page, booking.slot).click();
  const dialog = modal(page, "Gestión de Agenda");
  await expect(dialog).toBeVisible();
  await chooseOption(
    page,
    dialog.getByRole("combobox", { name: "Buscar Paciente" }),
    booking.patientName,
    booking.patientSearch,
  );
  await chooseOption(
    page,
    dialog.getByRole("combobox", { name: "Servicio a realizar" }),
    booking.serviceName,
  );
  await chooseOption(
    page,
    dialog.getByRole("combobox", { name: "Hora", exact: true }),
    booking.slot.label,
  );
  await dialog.getByRole("button", { name: "Confirmar Cita" }).click();
  await expect(dialog).toBeHidden();
  await expect(appointmentBlock(page, booking.patientName)).toBeVisible();
};
