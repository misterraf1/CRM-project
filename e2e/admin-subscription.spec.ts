import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

test("super admin activates a plan by hand, gives a company its own limits, and the history shows it", async ({ page, browser }) => {
  const company = `Manual Sub ${Date.now().toString(36)}`;
  await signupCompany(page, company);

  const admin = await (await browser.newContext({ locale: "az-AZ", viewport: { width: 1440, height: 900 } })).newPage();
  admin.on("dialog", (d) => d.accept());
  await admin.goto("/admin/login");
  await admin.getByLabel("Email").fill("platform@demo.axis");
  await admin.getByLabel("Şifrə").fill("demo12345");
  await admin.getByRole("button", { name: "Daxil ol" }).click();
  await expect(admin.getByRole("heading", { name: "Ümumi baxış" })).toBeVisible();
  await admin.goto(`/admin/tenants?q=${encodeURIComponent(company)}`);
  await admin.getByRole("link", { name: company }).click();
  await expect(admin.getByRole("heading", { name: company })).toBeVisible();

  // Bank transfer for a year of Pro
  await admin.getByRole("combobox", { name: /^Paket/ }).selectOption({ label: "Pro" });
  await admin.getByRole("combobox", { name: /^Dövr/ }).selectOption("YEAR");
  await expect(admin.getByLabel("Alınan məbləğ, ₼")).toHaveValue("990.00");
  await admin.getByLabel("Ödəniş sənədi").fill("KÖÇ-77");
  await admin.getByRole("button", { name: "Abunəliyi təyin et" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Abunəlik yeniləndi." })).toBeVisible();
  const history = admin.locator("section").filter({ has: admin.getByRole("heading", { name: "Abunəlik tarixçəsi" }) });
  await expect(history.getByText("Abunəlik təyin edildi")).toBeVisible();
  await expect(history.getByText("Sənəd: KÖÇ-77")).toBeVisible();
  await expect(admin.getByText("Aktiv").first()).toBeVisible();

  // A company-specific contact limit and a temporary extra feature
  await admin.getByRole("combobox", { name: "Müştəri limiti", exact: true }).selectOption("custom");
  await admin.getByLabel("Müştəri limiti: Xüsusi").fill("500");
  await admin.getByRole("checkbox", { name: "Avtomatlaşdırma", exact: true }).check();
  await admin.getByRole("button", { name: "Limitləri yadda saxla" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Limitlər yadda saxlanıldı." })).toBeVisible();
  await expect(history.getByText("Limitlər dəyişdi")).toBeVisible();

  // The company sees the new plan, the paid invoice and its limits
  await page.goto("/settings/billing");
  await expect(page.getByText("Pro").first()).toBeVisible();
  await expect(page.getByRole("meter", { name: "Müştərilər" })).toHaveAttribute("aria-valuemax", "500");
  await expect(page.getByRole("cell", { name: "Ödəniş (bizim tərəfimizdən qeyd edilib)" })).toBeVisible();
});
