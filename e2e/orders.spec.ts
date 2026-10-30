import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

test("quote → order with default steps → tick a step → the customer follows the progress on the quote link", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Sifariş MMC");
  const origin = new URL(page.url()).origin;
  const call = async (method: "post" | "patch", path: string, data: object) => {
    const res = await page.request[method](`/api/v1${path}`, { data, headers: { origin } });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return res.json();
  };
  await call("patch", "/settings/documents", { orderSteps: ["Ölçü", "İstehsal", "Quraşdırma"] });
  const c = await call("post", "/contacts", { name: "Kamran Əliyev" });
  const q = await call("post", "/docs", { kind: "quote", contactId: c.id, currency: "AZN", lines: [{ name: "Pəncərə", quantity: 3, unit: "ədəd", unitPrice: 20000 }] });
  const shared = await call("post", `/docs/${q.id}/send`, { email: false });

  await page.goto(`/sales/${q.id}`);
  await page.getByRole("link", { name: "Sifariş yarat" }).click();
  await expect(page.getByRole("heading", { name: "Yeni sifariş" })).toBeVisible();
  await expect(page.getByLabel("Addım 1")).toHaveValue("Ölçü");
  await expect(page.getByLabel("Addım 3")).toHaveValue("Quraşdırma");
  await page.getByRole("button", { name: "Sifarişi yarat" }).click();

  await expect(page.getByRole("heading", { name: /S-\d{4}-0001/ })).toBeVisible();
  await page.getByRole("checkbox", { name: /1\. Ölçü/ }).check();
  await expect(page.getByText("İcrada").first()).toBeVisible();

  const customer = await (await browser.newContext({ locale: "az-AZ" })).newPage();
  await customer.goto(shared.publicPath);
  const progress = customer.getByRole("region", { name: /Sifarişin gedişatı/ }).or(customer.locator("section", { hasText: "Sifarişin gedişatı" }));
  await expect(progress.getByText("İcrada")).toBeVisible();
  await expect(progress.getByText("Quraşdırma")).toBeVisible();
});
