import { expect, test } from "@playwright/test";
import { navTo, signupCompany } from "./helpers";

test("duplicate warning while adding a contact; the dashboard lists what needs attention", async ({ page }) => {
  await signupCompany(page, "Diqqət MMC");
  const origin = new URL(page.url()).origin;
  const res = await page.request.post("/api/v1/contacts", { data: { name: "Aysel Məmmədova", phone: "+994501234567" }, headers: { origin } });
  expect(res.ok()).toBeTruthy();

  await page.goto("/crm/new");
  await page.getByLabel("Ad", { exact: true }).fill("Aysel M.");
  await page.getByLabel("Telefon").fill("050 123 45 67");
  await page.getByLabel("Email").click();
  const warning = page.getByRole("status").filter({ hasText: "Bu məlumatla müştəri artıq var" });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("link", { name: "Aysel Məmmədova" })).toBeVisible();

  await navTo(page, "Dashboard");
  await expect(page.getByRole("heading", { name: "Diqqət tələb edir" })).toBeVisible();
  await expect(page.getByText("Hər şey nəzarətdədir")).toBeVisible();
  // Owners see what customers owe
  // Payments sit behind their tab in "Waiting for you"
  await page.getByRole("tab", { name: /Ödənişlər/ }).click();
  await expect(page.getByRole("heading", { name: "Gözlənilən ödənişlər" })).toBeVisible();
});
