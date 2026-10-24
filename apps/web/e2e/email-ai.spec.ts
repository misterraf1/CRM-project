import { expect, test } from "@playwright/test";
import { navTo, signupCompany } from "./helpers";

test("demo email channel in the inbox; AI buttons explain why they're off when the server has no key", async ({ page }) => {
  await signupCompany(page, "Email Demo MMC");
  await page.goto("/settings/channels");
  await page.getByRole("button", { name: "Email" }).click();
  await page.getByLabel("Dəstək email ünvanı").fill("satis@emaildemo.az");
  await expect(page.getByLabel("Demo rejimi (açarsız, mesajlar heç yerə göndərilmir)")).toBeChecked();
  await page.getByRole("button", { name: "Qoş", exact: true }).click();
  await expect(page.getByText("Demo", { exact: true })).toBeVisible();
  await page.getByLabel("Kimdən (nömrə və ya ad)").fill("aysu@mail.az");
  await page.getByLabel(/^Mesaj: /).fill("Qiymət siyahısını göndərə bilərsiniz?");
  await page.getByRole("button", { name: "Gələn mesaj yarat" }).click();
  await expect(page.getByText("Mesaj yaradıldı")).toBeVisible();

  await navTo(page, "Mesajlar");
  await page.getByRole("link", { name: /aysu@mail\.az/ }).click();
  const aiReply = page.getByRole("button", { name: "AI cavab təklifi" });
  await expect(aiReply).toBeDisabled();
  await expect(aiReply).toHaveAttribute("title", "AI köməkçisi bu serverdə qoşulmayıb.");
  await expect(page.getByRole("button", { name: "Xülasə" })).toBeDisabled();

  await page.getByRole("textbox", { name: "Müştəriyə cavab" }).fill("Salam! Siyahını bu gün göndəririk.");
  await page.getByRole("button", { name: "Göndər" }).click();
  await expect(page.getByText("Demo — göndərilmir")).toBeVisible();
});
