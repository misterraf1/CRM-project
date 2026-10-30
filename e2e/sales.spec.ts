import { expect, test, type Page } from "@playwright/test";
import { signupCompany } from "./helpers";

const origin = process.env.E2E_BASE_URL ?? "http://localhost:3000";
async function post<T>(page: Page, path: string, data: object): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: { origin } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as T;
}

test("catalog → quote with live totals → customer accepts by link → invoice → payment", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Sənəd MMC");
  await post(page, "/contacts", { name: "Aysel Məmmədova", email: "aysel@example.az" });

  // Catalog
  await page.goto("/sales/products");
  await page.getByRole("button", { name: "Yeni məhsul" }).click();
  await page.getByLabel("Ad", { exact: true }).fill("Veb sayt hazırlanması");
  await page.getByLabel("Qiymət", { exact: true }).fill("1500");
  await page.getByLabel("ƏDV %").fill("18");
  await page.getByRole("button", { name: "Əlavə et", exact: true }).click();
  await expect(page.getByText("Veb sayt hazırlanması")).toBeVisible();

  // Quote: a catalog line and a typed line with a discount
  await page.getByRole("link", { name: "Təkliflər" }).click();
  await page.getByRole("link", { name: "Yeni təklif" }).click();
  await page.getByLabel("Müştəri").selectOption({ label: "Aysel Məmmədova" });
  await page.getByLabel("Kataloqdan əlavə et").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Sətir əlavə et" }).click();
  await page.getByLabel("Ad 2").fill("Hostinq (il)");
  await page.getByLabel("Qiymət").nth(1).fill("100");
  await page.getByLabel("Endirim %").nth(1).fill("10");
  // 1500 + 18% = 1770 · 100 − 10% = 90 → 1860
  await expect(page.getByText("1.860,00 ₼", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Təklifi yarat" }).click();

  await expect(page.getByRole("heading", { name: /Kommersiya təklifi T-\d{4}-0001/ })).toBeVisible();
  await page.getByRole("button", { name: "Müştəri linki" }).click();
  await expect(page.getByText("Link hazırdır")).toBeVisible();
  const link = await page.getByLabel("Müştəri linki").inputValue();

  // The customer opens the link without an account and accepts
  const customer = await (await browser.newContext({ locale: "az-AZ" })).newPage();
  customer.on("dialog", (d) => d.accept());
  await customer.goto(link);
  await expect(customer.getByRole("heading", { name: "Kommersiya təklifi" })).toBeVisible();
  await expect(customer.getByText("Sənəd MMC göndərib")).toBeVisible();
  await customer.getByLabel("Adınız").fill("Aysel Məmmədova");
  await customer.getByRole("button", { name: "Qəbul edirəm" }).click();
  await expect(customer.getByText(/Aysel Məmmədova .* qəbul edib/)).toBeVisible();

  // Back in the CRM: accepted → invoice → issue → full payment
  await page.reload();
  await expect(page.getByText("Qəbul edilib").first()).toBeVisible();
  await page.getByRole("button", { name: "Faktura yarat" }).click();
  await expect(page.getByRole("heading", { name: /Hesab-faktura Qaralama/ })).toBeVisible();
  await page.getByRole("button", { name: "Çıxar və link yarat" }).click();
  await expect(page.getByRole("heading", { name: /Hesab-faktura F-\d{4}-0001/ })).toBeVisible();
  await page.getByRole("button", { name: "Ödənişi qeyd et" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ödəniş qeyd olundu." })).toBeVisible();
  await expect(page.getByText("Ödənilib").first()).toBeVisible();

  await page.goto("/sales?kind=invoice&status=paid");
  await expect(page.getByRole("link", { name: /F-\d{4}-0001/ })).toBeVisible();
});
