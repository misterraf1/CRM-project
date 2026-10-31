import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Sınaq-parol-123";

export const uniqueEmail = (tag: string) => `${tag}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@e2e.axis`;

/** Registers a fresh company through the real signup form and lands on the dashboard. */
export async function signupCompany(page: Page, companyName = "E2E Şirkət") {
  const email = uniqueEmail("owner");
  await page.goto("/signup");
  await page.getByLabel("Şirkətin adı").fill(companyName);
  await page.getByLabel("Ad və soyad").fill("Elvin Rzayev");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Şifrə").fill(PASSWORD);
  await page.getByRole("button", { name: "Qeydiyyatdan keç" }).click();
  await expect(page.getByRole("heading", { name: "Salam, Elvin" })).toBeVisible();
  return { email };
}

/** Kanban column by stage name. */
export const column = (page: Page, stage: string) => page.getByRole("region", { name: stage, exact: true });

/** Sidebar navigation (KPI cards link to the same pages; badges add a count to the link name). */
export const navTo = (page: Page, name: string) =>
  page.locator("aside nav").getByRole("link", { name: new RegExp(`^${name}(\\s+\\d+)?$`) }).click();

/** A deal card on the board (the whole card is the drag handle). */
export const card = (page: Page, stage: string, title: string) => column(page, stage).getByRole("listitem").filter({ hasText: title });

/** Drags a card by its top edge (the stage <select> sits in the middle of short cards). */
export const dragCard = (page: Page, from: string, title: string, to: string) =>
  card(page, from, title).dragTo(column(page, to), { sourcePosition: { x: 12, y: 8 } });

/** A section of the contact card (the card keeps its parts in tabs). */
export const recordTab = (page: Page, name: "Ümumi" | "Məlumatlar" | "Satışlar" | "Tapşırıq və zənglər" | "Fayllar və kabinet") =>
  page.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) }).click();
