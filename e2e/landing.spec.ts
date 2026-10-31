import { expect, test } from "@playwright/test";

test("landing: an owner understands the CRM by trying it, then signs up or signs in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Müştərilər, satışlar və komanda");

  // The sales board: tapping a card moves the deal on; winning it creates the invoice
  const board = page.getByRole("region", { name: "Qazanıldı" });
  const deal = page.getByRole("button", { name: /Sayt yenilənməsi.*Növbəti mərhələyə keçir/ });
  await deal.click();
  await expect(board.getByText("Sayt yenilənməsi")).toBeVisible();
  await expect(page.getByRole("status").getByText(/faktura avtomatik yaradıldı/)).toBeVisible();

  // Before / after for the owner
  await page.getByRole("radio", { name: "Axis-dən əvvəl" }).click();
  await expect(page.getByText(/Müştərilər WhatsApp-da, dəftərdə/)).toBeVisible();
  await page.getByRole("radio", { name: "Axis ilə" }).click();
  await expect(page.getByText(/Bütün müştərilər bir bazada/)).toBeVisible();

  // The tour: a quote that updates as you change it, sent, accepted, paid
  await page.getByRole("tab", { name: "Təklif və faktura" }).click();
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("button", { name: "Miqdar +" }).click();
  await expect(panel.getByText("13", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Müştəriyə göndər" }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "Ödənildi" })).toHaveClass(/text-success/, { timeout: 5000 });
  await page.getByRole("tab", { name: "Tapşırıqlar" }).click();
  await page.getByRole("tabpanel").getByRole("checkbox").nth(1).check();
  await expect(page.getByRole("tabpanel").getByText("2/4 tamamlandı")).toBeVisible();

  // Prices come from the plans on sale
  await page.getByRole("navigation").getByRole("link", { name: "Qiymətlər" }).first().click();
  await expect(page.getByRole("heading", { name: "Sadə qiymətlər" })).toBeVisible();
  await page.getByText("CRM nədir və mənə niyə lazımdır?").click();
  await expect(page.getByText(/Müştəri unudulmur, satış itmir/)).toBeVisible();

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
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Customers, sales and your team");
  await page.getByRole("button", { name: "AZ", exact: true }).first().click();
});
