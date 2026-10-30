import { expect, test } from "@playwright/test";
import { navTo, signupCompany } from "./helpers";

test("closed all week with an away message: the customer gets it; operator sets themselves away", async ({ page }) => {
  await signupCompany(page, "Saat MMC");
  await page.goto("/settings/channels");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "İş saatları və cavab müddəti" }) });
  for (const d of ["Bazar ertəsi", "Çərşənbə axşamı", "Çərşənbə", "Cümə axşamı", "Cümə"]) await card.getByRole("checkbox", { name: d, exact: true }).uncheck();
  await card.getByLabel("İş vaxtından kənar avtomatik cavab göndər").check();
  await card.getByLabel("Avtomatik cavabın mətni").fill("Hazırda bağlıyıq, səhər yazacağıq.");
  await card.getByLabel("İlk cavab hədəfi (SLA), dəqiqə").fill("30");
  await card.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(card.getByRole("status")).toHaveText("Yadda saxlanıldı.");

  await page.getByRole("button", { name: "WhatsApp" }).click();
  await page.getByRole("button", { name: "Qoş", exact: true }).click();
  await page.getByLabel("Kimdən (nömrə və ya ad)").fill("+994 70 999 88 77");
  await page.getByLabel(/^Mesaj: /).fill("Salam, açıqsınız?");
  await page.getByRole("button", { name: "Gələn mesaj yarat" }).click();
  await expect(page.getByText("Mesaj yaradıldı")).toBeVisible();

  await navTo(page, "Mesajlar");
  await page.getByRole("link", { name: /\+994 70 999 88 77/ }).click();
  const log = page.getByRole("log");
  await expect(log.getByText("Hazırda bağlıyıq, səhər yazacağıq.")).toBeVisible();
  await expect(log.getByText(/Avtomatik cavab/)).toBeVisible();

  // Operator status lives in the sidebar
  const saved = page.waitForResponse((r) => r.url().includes("/members/me/presence") && r.ok());
  await page.getByRole("button", { name: "Onlayn" }).click();
  await expect(page.getByRole("button", { name: "Uzaqda" })).toBeVisible();
  await saved;
  await page.reload();
  await expect(page.getByRole("button", { name: "Uzaqda" })).toBeVisible();
});
