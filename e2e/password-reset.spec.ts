import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";
import { withDb } from "./db";

test("forgot password: emailed link → new password → old one stops working", async ({ page }) => {
  const { email } = await signupCompany(page, "Şifrə MMC");
  await page.getByRole("button", { name: /Çıxış/ }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByRole("link", { name: "Şifrəni unutmusunuz?" }).click();
  await expect(page.getByRole("heading", { name: "Şifrənin bərpası" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Link göndər" }).click();
  await expect(page.getByRole("status")).toContainText("Bu email ilə hesab varsa");

  // Without SMTP the message stays in the mail log; the test reads the link from there
  const mail = await withDb((db) => db.emailMessage.findFirstOrThrow({ where: { to: email, template: "password_reset" }, orderBy: { createdAt: "desc" } }));
  const link = /https?:\/\/[^\s]+\/reset-password\/[\w-]+/.exec(mail.text)![0];
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { name: "Yeni şifrə" })).toBeVisible();
  await page.getByLabel("Şifrə").fill("Tamamile-yeni-123");
  await page.getByRole("button", { name: "Şifrəni yenilə" }).click();
  await expect(page.getByRole("status")).toContainText("Şifrə yeniləndi");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Şifrə").fill("Sınaq-parol-123");
  await page.getByRole("button", { name: "Daxil ol" }).click();
  await expect(page.getByText("Email və ya şifrə yanlışdır.")).toBeVisible();
  await page.getByLabel("Şifrə").fill("Tamamile-yeni-123");
  await page.getByRole("button", { name: "Daxil ol" }).click();
  await expect(page.getByRole("heading", { name: "Salam, Elvin" })).toBeVisible();

  // The link is single-use
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Şifrə").fill("Bir-daha-yeni-123");
  await page.getByRole("button", { name: "Şifrəni yenilə" }).click();
  await expect(page.getByText("Link etibarsızdır")).toBeVisible();
});
