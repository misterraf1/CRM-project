import { expect, test } from "@playwright/test";
import { totp } from "../src/server/common/totp";
import { PASSWORD, signupCompany, uniqueEmail } from "./helpers";

const STEP = 30_000;

test("company 2FA: the owner turns it on, requires it for everyone; sign-in asks for the code; a new member must set it up first", async ({ page, browser }) => {
  const { email } = await signupCompany(page, "Təhlükəsiz MMC");
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: "Təhlükəsizlik", level: 1 })).toBeVisible();
  // The rule needs the owner's own 2FA first
  await page.getByRole("checkbox", { name: "Bütün işçilər üçün 2FA məcburi olsun" }).check();
  await expect(page.getByText("Əvvəlcə öz hesabınızda 2FA-nı aktiv edin.")).toBeVisible();

  await page.getByRole("button", { name: "2FA-nı qur" }).click();
  const secret = (await page.locator("code").innerText()).trim();
  await page.getByLabel("Kod").fill(totp(secret));
  await page.getByRole("button", { name: "Aktiv et" }).click();
  await expect(page.getByRole("list", { name: "Ehtiyat kodlar" }).getByRole("listitem")).toHaveCount(10);
  await page.getByRole("button", { name: "Hazırdır" }).click();
  await expect(page.getByText("2FA aktivdir")).toBeVisible();
  await page.getByRole("checkbox", { name: "Bütün işçilər üçün 2FA məcburi olsun" }).check();
  await expect(page.getByText("Yadda saxlanıldı.")).toBeVisible();

  // Invite a member while the rule is on
  const origin = new URL(page.url()).origin;
  const invite = await (await page.request.post("/api/v1/members/invites", { data: { email: uniqueEmail("emp"), role: "EMPLOYEE", fullName: "Nigar Qasımova" }, headers: { origin } })).json();

  // Owner signs in again: the password step is followed by the code step
  await page.getByRole("button", { name: "Çıxış" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Şifrə").fill(PASSWORD);
  await page.getByRole("button", { name: "Daxil ol" }).click();
  await expect(page.getByRole("heading", { name: "Doğrulama kodu" })).toBeVisible();
  await page.getByLabel("Kod").fill("000000");
  await page.getByRole("button", { name: "Təsdiq et" }).click();
  await expect(page.getByText("Kod yanlışdır və ya artıq istifadə olunub.")).toBeVisible();
  await page.getByLabel("Kod").fill(totp(secret, Date.now() + STEP));
  await page.getByRole("button", { name: "Təsdiq et" }).click();
  await expect(page.getByRole("heading", { name: "Salam, Elvin" })).toBeVisible();

  // The new member lands on the setup page and only gets in after setting it up
  const emp = await (await browser.newContext({ locale: "az-AZ" })).newPage();
  await emp.goto(`${origin}${invite.invitePath}`);
  await emp.getByLabel("Şifrə").fill(PASSWORD);
  await emp.getByRole("button", { name: "Dəvəti qəbul et" }).click();
  await expect(emp.getByRole("heading", { name: "İki mərhələli girişi qurun" })).toBeVisible();
  await emp.goto("/crm");
  await expect(emp.getByRole("heading", { name: "İki mərhələli girişi qurun" })).toBeVisible();
  await emp.getByRole("button", { name: "2FA-nı qur" }).click();
  const empSecret = (await emp.locator("code").innerText()).trim();
  await emp.getByLabel("Kod").fill(totp(empSecret));
  await emp.getByRole("button", { name: "Aktiv et" }).click();
  await emp.getByRole("button", { name: "Hazırdır" }).click();
  await expect(emp.getByRole("heading", { name: "Salam, Nigar" })).toBeVisible();
});
