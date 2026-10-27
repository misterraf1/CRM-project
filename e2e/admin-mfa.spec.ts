import { expect, test } from "@playwright/test";
import { hashPassword } from "../src/server/auth/password";
import { totp } from "../src/server/common/totp";
import { PASSWORD, uniqueEmail } from "./helpers";
import { withDb } from "./db";

const STEP = 30_000;

test("platform 2FA: set up with the QR key, recovery codes, then sign-in asks for the code", async ({ page }) => {
  const email = uniqueEmail("staff2fa");
  const passwordHash = await hashPassword(PASSWORD);
  const user = await withDb((db) => db.user.insertOne({ email, fullName: "2FA Test", passwordHash, platformRole: "SUPPORT", mfaRecoveryCodes: [] }));
  try {
    const signIn = async () => {
      await page.goto("/admin/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Şifrə").fill(PASSWORD);
      await page.getByRole("button", { name: "Daxil ol" }).click();
    };
    await signIn();
    await expect(page.getByRole("heading", { name: "Ümumi baxış" })).toBeVisible();

    await page.getByRole("navigation", { name: "Platforma idarəsi" }).getByRole("link", { name: "Təhlükəsizlik" }).click();
    await expect(page.getByText("2FA aktiv deyil")).toBeVisible();
    await page.getByRole("button", { name: "2FA-nı qur" }).click();
    await expect(page.getByRole("img", { name: "QR" })).toBeVisible();
    const secret = (await page.locator("code").innerText()).trim();
    await page.getByLabel("Kod").fill("000000");
    await page.getByRole("button", { name: "Aktiv et" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Kod yanlışdır");
    await page.getByLabel("Kod").fill(totp(secret));
    await page.getByRole("button", { name: "Aktiv et" }).click();
    const codes = page.getByRole("list", { name: "Ehtiyat kodlar" }).getByRole("listitem");
    await expect(codes).toHaveCount(10);
    const recovery = await codes.first().innerText();
    await page.getByRole("button", { name: "Hazırdır" }).click();
    await expect(page.getByText("2FA aktivdir")).toBeVisible();

    // Sign out; the password alone no longer opens the console
    await page.getByRole("button", { name: "Çıxış" }).click();
    await signIn();
    await expect(page.getByRole("heading", { name: "Doğrulama kodu" })).toBeVisible();
    await page.getByLabel("Kod").fill("111111");
    await page.getByRole("button", { name: "Təsdiq et" }).click();
    await expect(page.getByText("Kod yanlışdır və ya artıq istifadə olunub.")).toBeVisible();
    await page.getByLabel("Kod").fill(totp(secret, Date.now() + STEP));
    await page.getByRole("button", { name: "Təsdiq et" }).click();
    await expect(page.getByRole("heading", { name: "Ümumi baxış" })).toBeVisible();

    // A recovery code works too
    await page.getByRole("button", { name: "Çıxış" }).click();
    await signIn();
    await page.getByLabel("Kod").fill(recovery);
    await page.getByRole("button", { name: "Təsdiq et" }).click();
    await expect(page.getByRole("heading", { name: "Ümumi baxış" })).toBeVisible();
  } finally {
    await withDb((db) => db.user.delete({ id: user.id }));
  }
});
