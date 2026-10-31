import { expect, test } from "@playwright/test";
import { card as dealCard, column, dragCard, navTo, PASSWORD, recordTab, signupCompany, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

test("signup → contact → note → deal → kanban → won makes a customer", async ({ page }) => {
  await signupCompany(page, "Kanban MMC");

  // Dashboard of a brand-new company: real zeros everywhere
  await expect(page.getByText("Yeni müştərilər")).toBeVisible();

  // Create a contact through the form
  await navTo(page, "Müştərilər");
  await expect(page.getByText("Müştəri tapılmadı")).toBeVisible();
  await page.getByRole("link", { name: "Yeni müştəri" }).click();
  await page.getByLabel("Ad", { exact: true }).fill("Orxan Səfərov");
  await page.getByLabel("Telefon").fill("+994 50 123 45 67");
  await page.getByLabel("Email").fill("orxan@example.az");
  await page.getByRole("button", { name: "Yarat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orxan Səfərov" })).toBeVisible();
  await expect(page.getByText("+994501234567").first()).toBeVisible();
  await expect(page.getByText("yeni müştəri əlavə etdi: Orxan Səfərov")).toBeVisible();

  // Edit stage, then add a note
  await recordTab(page, "Məlumatlar");
  await page.getByLabel("Status").selectOption("QUALIFIED");
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(page.getByRole("status")).toHaveText("Yadda saxlanıldı");
  await recordTab(page, "Ümumi");
  await expect(page.getByText("Orxan Səfərov: Lead → Kvalifikasiya")).toBeVisible();
  await page.getByLabel("Qeyd əlavə et").fill("Zəng etdim, təklif istəyir");
  await page.getByRole("button", { name: "Qeyd əlavə et" }).click();
  await expect(page.getByText("Zəng etdim, təklif istəyir")).toBeVisible();

  // Deal from the contact card
  await recordTab(page, "Satışlar");
  await page.getByRole("button", { name: "Satış əlavə et" }).click();
  await page.getByLabel("Satışın adı").fill("CRM lisenziyası");
  await page.getByLabel("Məbləğ", { exact: true }).fill("4 800");
  await page.getByRole("button", { name: "Yarat", exact: true }).click();
  await expect(page.getByRole("link", { name: /CRM lisenziyası/ })).toBeVisible();

  // Kanban: move with the stage select (keyboard/touch path)
  await navTo(page, "Satışlar");
  await expect(column(page, "Yeni").getByText("CRM lisenziyası")).toBeVisible();
  await column(page, "Yeni").getByLabel("Mərhələ: CRM lisenziyası").selectOption({ label: "Təklif" });
  await expect(column(page, "Təklif").getByText("CRM lisenziyası")).toBeVisible();
  await expect(column(page, "Təklif").getByText("1 satış · 4.800 ₼")).toBeVisible();
  // Forecast = 4 800 × 50 %
  await expect(page.getByText("2.400 ₼")).toBeVisible();

  // Drag & drop into "won"
  await dragCard(page, "Təklif", "CRM lisenziyası", "Qazanıldı");
  await expect(column(page, "Qazanıldı").getByText("CRM lisenziyası")).toBeVisible();
  await expect(page.getByText("Bu ay qazanılan").locator("..").getByText("4.800 ₼")).toBeVisible();

  // Winning turned the contact into a customer automatically
  await navTo(page, "Müştərilər");
  await expect(page.getByRole("row", { name: /Orxan Səfərov/ }).getByText("Müştəri")).toBeVisible();

  // Dashboard shows the real revenue now
  await navTo(page, "Dashboard");
  await expect(page.getByText("4.800 ₼").first()).toBeVisible();
  await expect(page.getByText(/satışını bağladı/)).toBeVisible();
});

test("dragging to lost asks for a reason; cancelling keeps the deal open", async ({ page }) => {
  await signupCompany(page, "İtki MMC");
  await page.goto("/deals");
  await page.getByRole("button", { name: "Yeni satış" }).click();
  await page.getByLabel("Satışın adı").fill("Bahalı layihə");
  await page.getByLabel("Məbləğ", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Yarat", exact: true }).click();
  const card = dealCard(page, "Yeni", "Bahalı layihə");
  await expect(card).toBeVisible();

  await dragCard(page, "Yeni", "Bahalı layihə", "İtirildi");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Satış niyə itirildi?")).toBeVisible();
  await dialog.getByRole("button", { name: "Ləğv et" }).click();
  await expect(column(page, "Yeni").getByText("Bahalı layihə")).toBeVisible();

  await dragCard(page, "Yeni", "Bahalı layihə", "İtirildi");
  await dialog.getByLabel("Rəqib").check();
  await dialog.getByRole("button", { name: "Təsdiqlə" }).click();
  await expect(column(page, "İtirildi").getByText("Rəqib")).toBeVisible();
  await expect(page.getByText("Əsas səbəb: Rəqib")).toBeVisible();
});

test("invited employee joins, sees only own customers, cannot manage members", async ({ page, browser }) => {
  await signupCompany(page, "Rollar MMC");
  await page.goto("/crm/new");
  await page.getByLabel("Ad", { exact: true }).fill("Sahibin müştərisi");
  await page.getByRole("button", { name: "Yarat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sahibin müştərisi" })).toBeVisible();

  await page.goto("/settings/members");
  await page.getByRole("button", { name: "İşçi dəvət et" }).click();
  await page.getByLabel("Email", { exact: true }).fill(uniqueEmail("emp"));
  await page.getByRole("button", { name: "Dəvət yarat" }).click();
  const link = await page.locator("input[readonly]").inputValue();
  expect(link).toContain("/invite/");

  const emp = await (await browser.newContext({ locale: "az-AZ" })).newPage();
  await emp.goto(link);
  await expect(emp.getByRole("heading", { name: "Rollar MMC sizi dəvət edir" })).toBeVisible();
  await emp.getByLabel("Ad və soyad").fill("Nigar Qasımova");
  await emp.getByLabel("Şifrə").fill(PASSWORD);
  await emp.getByRole("button", { name: "Dəvəti qəbul et" }).click();
  await expect(emp.getByRole("heading", { name: "Salam, Nigar" })).toBeVisible();

  await emp.goto("/crm");
  await expect(emp.getByText("Müştəri tapılmadı")).toBeVisible();
  await emp.goto("/settings/members");
  await expect(emp.getByRole("cell", { name: /Elvin Rzayev/ })).toBeVisible();
  await expect(emp.getByRole("button", { name: "İşçi dəvət et" })).toHaveCount(0);
  await expect(emp.getByRole("button", { name: "Deaktiv et" })).toHaveCount(0);
});

test("language switch and logout", async ({ page }) => {
  await signupCompany(page, "Dil MMC");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hello, Elvin" })).toBeVisible();
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Здравствуйте, Elvin" })).toBeVisible();
  await page.getByRole("button", { name: "AZ", exact: true }).click();
  await page.getByRole("button", { name: "Çıxış" }).click();
  await expect(page.getByRole("heading", { name: "Hesabınıza daxil olun" })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
