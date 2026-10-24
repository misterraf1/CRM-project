import { expect, test, type Browser, type Page } from "@playwright/test";
import { signupCompany } from "./helpers";

test.describe.configure({ mode: "serial" });

/** Platform staff sign in through their own form (demo seed accounts). */
async function staffLogin(browser: Browser, email: string) {
  const page = await (await browser.newContext({ locale: "az-AZ", viewport: { width: 1440, height: 900 } })).newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Şifrə").fill("demo12345");
  await page.getByRole("button", { name: "Daxil ol" }).click();
  await expect(page.getByRole("heading", { name: "Ümumi baxış" })).toBeVisible();
  return page;
}

const adminNav = (page: Page, name: string) => page.getByRole("navigation", { name: "Platforma idarəsi" }).getByRole("link", { name });

test("company ticket → platform support replies → super admin extends trial, suspends, books a cost", async ({ page, browser }) => {
  const company = `Admin Test ${Date.now().toString(36)}`;
  await signupCompany(page, company);

  // A company session is not a platform session
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByText("Yalnız Axis komandası üçün")).toBeVisible();

  // The company asks for help
  await page.goto("/support");
  await page.getByLabel("Mövzu").fill("Faktura sualı");
  await page.getByLabel("Təsvir").fill("İllik ödəniş üçün faktura lazımdır.");
  await page.getByRole("button", { name: "Göndər" }).click();
  await expect(page.getByRole("heading", { name: "Faktura sualı" })).toBeVisible();
  const ticketUrl = page.url();

  // Platform support answers
  const support = await staffLogin(browser, "support@demo.axis");
  await expect(adminNav(support, "Xərclər")).toHaveCount(0);
  await adminNav(support, "Müraciətlər").click();
  await support.getByRole("link", { name: new RegExp(`Faktura sualı.*${company}`) }).click();
  await support.getByPlaceholder("Cavab yazın…").fill("Salam! Fakturanı Abunəlik bölməsindən yükləyə bilərsiniz.");
  await support.getByRole("button", { name: "Göndər" }).click();
  await expect(support.getByText("Salam! Fakturanı Abunəlik bölməsindən yükləyə bilərsiniz.")).toBeVisible();
  await expect(support.getByLabel("Status")).toHaveValue("in_progress");

  // The company sees the reply from "Axis dəstək" and gets a notification
  await page.goto(ticketUrl);
  await expect(page.getByText("Salam! Fakturanı Abunəlik bölməsindən yükləyə bilərsiniz.")).toBeVisible();
  await expect(page.getByText("Axis dəstək").first()).toBeVisible();
  await page.getByRole("button", { name: /Bildirişlər/ }).click();
  await expect(page.getByText("Dəstək cavab verdi: Faktura sualı")).toBeVisible();

  // Super admin: find the company, extend the trial, then suspend it
  const admin = await staffLogin(browser, "platform@demo.axis");
  await adminNav(admin, "Şirkətlər").click();
  await admin.getByPlaceholder("Ad və ya ünvan üzrə axtarış").fill(company);
  await admin.getByPlaceholder("Ad və ya ünvan üzrə axtarış").press("Enter");
  await admin.getByRole("link", { name: company }).click();
  await expect(admin.getByRole("heading", { name: company })).toBeVisible();
  await admin.getByRole("button", { name: "Sınağı uzat" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Yerinə yetirildi" })).toBeVisible();
  await expect(admin.getByText("platform.trial_extended")).toBeVisible();

  await admin.getByLabel("Səbəb (audit jurnalına yazılır)").fill("Sınaq məqsədilə");
  await admin.getByRole("button", { name: "Dayandır" }).click();
  await expect(admin.getByText("Dayandırılıb").first()).toBeVisible();

  // The company is now read-only and sees why
  await page.goto("/dashboard");
  await expect(page.getByRole("status").filter({ hasText: "Abunəlik dayandırılıb" })).toBeVisible();

  // Costs: add one and remove it again (profit math lives in the API tests)
  await adminNav(admin, "Xərclər").click();
  await admin.getByLabel("Təchizatçı").fill("E2E Cloud");
  await admin.getByLabel("Məbləğ, ₼").fill("12.50");
  await admin.getByRole("button", { name: "Xərc əlavə et" }).click();
  await expect(admin.getByRole("cell", { name: "E2E Cloud", exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "Sil: E2E Cloud" }).click();
  await expect(admin.getByRole("cell", { name: "E2E Cloud", exact: true })).toHaveCount(0);

  // System health and the overview chart render real figures
  await adminNav(admin, "Sistem").click();
  await expect(admin.getByText("İşləyir")).toBeVisible();
  await expect(admin.getByText("DEMO — real ödəniş alınmır")).toBeVisible();
  await adminNav(admin, "Ümumi baxış").click();
  await expect(admin.getByRole("table").filter({ hasText: "Gəlir" })).toBeVisible();

  // Signing out ends the platform session
  await admin.getByRole("button", { name: "Çıxış" }).click();
  await expect(admin).toHaveURL(/\/admin\/login/);
  await admin.goto("/admin/tenants");
  await expect(admin).toHaveURL(/\/admin\/login/);
});
