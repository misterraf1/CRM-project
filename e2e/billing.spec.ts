import { expect, test, type Page } from "@playwright/test";
import { signupCompany } from "./helpers";

test.describe.configure({ mode: "serial" });

const plan = (page: Page, name: string) => page.getByRole("article", { name, exact: true });

/** Demo checkout: one declined attempt, then a successful one. */
async function payOnCheckout(page: Page) {
  await expect(page).toHaveURL(/\/billing\/checkout\//);
  await expect(page.getByText("DEMO ödəniş səhifəsi")).toBeVisible();
  await page.getByRole("button", { name: "Kart rədd edilsin" }).click();
  await expect(page.getByText("Kart rədd edildi. Başqa kartla yenidən cəhd edin.")).toBeVisible();
  await page.getByRole("button", { name: "Uğurlu ödəniş" }).click();
  await expect(page).toHaveURL(/\/settings\/billing\?paid=1/);
  await expect(page.getByText("Ödəniş qəbul edildi. Təşəkkür edirik!")).toBeVisible();
}

test("trial → demo checkout → failed renewal and grace → pay → scheduled downgrade locks PRO modules", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Abunə MMC");

  await page.goto("/settings/members");
  await page.getByRole("link", { name: "Abunəlik" }).click();
  await expect(page.getByRole("heading", { name: "Abunəlik" })).toBeVisible();
  await expect(page.getByText(/DEMO ödəniş rejimi/)).toBeVisible();
  await expect(page.getByText("Sınaq", { exact: true })).toBeVisible();
  await expect(page.getByText(/Sınaq .* tarixində bitir/)).toBeVisible();

  // Buy PRO monthly through the demo hosted checkout
  await plan(page, "Pro").getByRole("button", { name: "Seç" }).click();
  await payOnCheckout(page);
  await expect(page.getByText("Aktiv", { exact: true })).toBeVisible();
  await expect(plan(page, "Pro").getByRole("button", { name: "Cari paket" })).toBeDisabled();
  await expect(page.getByText(/Visa •••• 4242/)).toBeVisible();
  const invoices = page.getByRole("table");
  await expect(invoices.getByText("Ödənilib")).toBeVisible();

  // Printable invoice
  await invoices.getByRole("link", { name: "Bax" }).first().click();
  await expect(page.getByText(/AX-\d{4}-\d{6}/)).toBeVisible();
  await expect(page.getByText("Abunə MMC")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Abunəlik", exact: true }).first().click();

  // PRO: deals and team open, departments locked
  await expect(page.locator("aside nav").getByRole("link", { name: /^Satışlar/ })).not.toHaveAttribute("title", /Cari paketdə yoxdur/);
  await page.goto("/settings/members");
  await expect(page.getByRole("main").getByRole("link", { name: "Cari paketdə yoxdur — paketi yüksəldin" })).toBeVisible();

  // Renewal declined → grace period, banner on every page
  await page.goto("/settings/billing");
  await page.getByLabel("Növbəti avtomatik ödəniş uğursuz olsun").check();
  await expect(page.getByLabel("Növbəti avtomatik ödəniş uğursuz olsun")).toBeChecked();
  await page.getByRole("button", { name: "Növbəti tarixi indi işlət" }).click();
  await expect(page.getByText("Ödəniş gecikir", { exact: true })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("status").filter({ hasText: "Abunəlik ödənişi alınmadı" })).toBeVisible();

  // Pay the failed renewal
  await page.getByRole("link", { name: "Abunəliyə keç" }).click();
  await page.getByLabel("Növbəti avtomatik ödəniş uğursuz olsun").uncheck();
  await expect(page.getByLabel("Növbəti avtomatik ödəniş uğursuz olsun")).not.toBeChecked();
  await page.getByRole("button", { name: "İndi ödə" }).click();
  await payOnCheckout(page);
  await expect(page.getByText("Aktiv", { exact: true })).toBeVisible();

  // Downgrade to START at period end, then let the period end
  await plan(page, "Start").getByRole("button", { name: "Dövrün sonunda keç" }).click();
  await expect(page.getByText(/START paketinə keçid/)).toBeVisible();
  await page.getByRole("button", { name: "Növbəti tarixi indi işlət" }).click();
  await expect(plan(page, "Start").getByRole("button", { name: "Cari paket" })).toBeDisabled();

  // START: deals and team are behind the upgrade gate, with a lock in the sidebar
  await expect(page.locator("aside nav").getByRole("link", { name: /^Satışlar/ })).toHaveAttribute("title", /Cari paketdə yoxdur/);
  await page.goto("/deals");
  await expect(page.getByRole("heading", { name: "Bu funksiya PRO paketindədir" })).toBeVisible();
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Bu funksiya PRO paketindədir" })).toBeVisible();
  await page.getByRole("link", { name: "Paketlərə bax" }).click();
  await expect(page).toHaveURL(/\/settings\/billing/);
});
