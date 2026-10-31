import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

// Phone width: no page may scroll sideways (tables scroll inside their own card)
test.use({ viewport: { width: 390, height: 844 } });

test("company pages fit a 390px phone screen", async ({ page }) => {
  // Thirty pages, each compiled on first visit by the dev server
  test.setTimeout(240_000);
  await signupCompany(page, "Mobil MMC");
  for (const path of ["/dashboard", "/crm", "/deals", "/tasks", "/inbox", "/chat", "/team", "/files", "/analytics", "/automations", "/support", "/settings/members", "/settings/channels", "/settings/billing", "/settings/roles", "/settings/crm", "/sales", "/sales/products", "/orders", "/calendar", "/calendar?view=week", "/today", "/settings/security", "/cases", "/cases/new", "/targets", "/sales/renewals", "/settings/forms", "/settings/integrations", "/campaigns"]) {
    await page.goto(path);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: path }).toBeLessThanOrEqual(390);
  }
});

test("platform console fits a 390px phone screen", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("platform@demo.axis");
  await page.getByLabel("Şifrə").fill("demo12345");
  await page.getByRole("button", { name: "Daxil ol" }).click();
  await expect(page.getByRole("heading", { name: "Ümumi baxış" })).toBeVisible();
  for (const path of ["/admin", "/admin/tenants", "/admin/plans", "/admin/billing", "/admin/expenses", "/admin/tickets", "/admin/system"]) {
    await page.goto(path);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: path }).toBeLessThanOrEqual(390);
  }
});
