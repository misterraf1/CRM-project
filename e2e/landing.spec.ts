import { expect, test } from "@playwright/test";

test("landing: anonymous visitors see the product and prices, and go on to sign up or sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Müştəriləriniz hər yerdən yazır.");
  // Prices come from the plans on sale
  await page.getByRole("navigation").getByRole("link", { name: "Qiymətlər" }).first().click();
  await expect(page.getByRole("heading", { name: "Sadə qiymətlər" })).toBeVisible();
  await expect(page.getByText("Ən çox seçilən")).toBeVisible();
  // FAQ opens
  await page.getByText("WhatsApp-ı necə qoşuram?").click();
  await expect(page.getByText(/Ayarlar → Kanallar/)).toBeVisible();

  await page.getByRole("banner").getByRole("link", { name: "Pulsuz başla" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Daxil ol" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("landing on a phone: menu drawer, no sideways scroll, language switch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Menyunu aç" }).click();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your customers write from everywhere.");
  await page.getByRole("button", { name: "AZ", exact: true }).first().click();
});
