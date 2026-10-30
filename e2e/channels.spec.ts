import { expect, test } from "@playwright/test";
import { navTo, signupCompany } from "./helpers";

test("WhatsApp template from the conversation; Telegram appears among the channels", async ({ page }) => {
  await signupCompany(page, "Şablon MMC");
  await page.goto("/settings/channels");
  // Telegram is offered with its own connection form
  await page.getByRole("button", { name: "Telegram" }).click();
  await expect(page.getByLabel("Demo rejimi (açarsız, mesajlar heç yerə göndərilmir)")).toBeChecked();
  await page.getByLabel("Demo rejimi (açarsız, mesajlar heç yerə göndərilmir)").uncheck();
  await expect(page.getByLabel("Bot tokeni")).toBeVisible();
  await page.getByLabel("Demo rejimi (açarsız, mesajlar heç yerə göndərilmir)").check();
  await page.getByRole("button", { name: "Ləğv et" }).click();

  await page.getByRole("button", { name: "WhatsApp" }).click();
  await page.getByRole("button", { name: "Qoş", exact: true }).click();
  await expect(page.getByText(/2 şablon/)).toBeVisible();
  await page.getByLabel("Kimdən (nömrə və ya ad)").fill("+994 55 444 33 22");
  await page.getByLabel(/^Mesaj: /).fill("Salam");
  await page.getByRole("button", { name: "Gələn mesaj yarat" }).click();
  await expect(page.getByText("Mesaj yaradıldı")).toBeVisible();

  await navTo(page, "Mesajlar");
  await page.getByRole("link", { name: /\+994 55 444 33 22/ }).click();
  await page.getByRole("button", { name: "WhatsApp şablonu" }).click();
  await page.getByLabel("WhatsApp şablonu").selectOption({ label: "follow_up (az)" });
  await page.getByLabel("{{1}}").fill("Orxan");
  await expect(page.getByText("Salam Orxan, təklifimizə baxa bildinizmi?").first()).toBeVisible();
  await page.getByRole("button", { name: "Şablonu göndər" }).click();
  await expect(page.getByRole("log").getByText("Salam Orxan, təklifimizə baxa bildinizmi?")).toBeVisible();
});
