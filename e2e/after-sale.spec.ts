import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date());

test("a complaint from the customer card: opened, noted, resolved; it shows on the card, the timeline and Today", async ({ page }) => {
  await signupCompany(page, "Servis MMC");
  const origin = new URL(page.url()).origin;
  const c = await (await page.request.post("/api/v1/contacts", { data: { name: "Fərid Həsənov", email: "farid@example.az" }, headers: { origin } })).json();

  await page.goto(`/crm/${c.id}`);
  await page.getByRole("region", { name: "Müştəri dəyəri" }).getByRole("link", { name: "Yeni müraciət" }).click();
  await expect(page.getByRole("heading", { name: "Yeni müraciət" })).toBeVisible();
  await expect(page.getByText("Fərid Həsənov")).toBeVisible();
  await page.getByLabel("Mövzu").fill("Kondisioner səs salır");
  await page.getByLabel("Prioritet").selectOption("HIGH");
  await page.getByRole("button", { name: "Müraciəti aç" }).click();

  await expect(page.getByRole("heading", { name: "Kondisioner səs salır" })).toBeVisible();
  await page.getByRole("textbox", { name: "Qeydlər" }).fill("Usta sabah gedəcək");
  await page.getByRole("button", { name: "Əlavə et" }).click();
  await expect(page.getByText("Usta sabah gedəcək")).toBeVisible();

  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Mənim müraciətlərim" }).getByText("Kondisioner səs salır")).toBeVisible();
  await page.getByRole("region", { name: "Mənim müraciətlərim" }).getByText("Kondisioner səs salır").click();
  await page.getByLabel("Status").selectOption("resolved");
  await expect(page.getByText("Həll olundu").first()).toBeVisible();

  await page.goto(`/crm/${c.id}`);
  await expect(page.getByRole("region", { name: "Müştəri dəyəri" }).getByText("Kondisioner səs salır")).toBeVisible();
  await expect(page.getByText(/müraciəti həll olundu: «Kondisioner səs salır»/)).toBeVisible();
});

test("renewals, targets and an automation template", async ({ page }) => {
  await signupCompany(page, "Hosting MMC");
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: object) => {
    const res = await page.request.post(`/api/v1${path}`, { data, headers: { origin } });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return res.json();
  };
  const c = await post("/contacts", { name: "Sayt sahibi" });
  const p = await post("/products", { name: "Hosting illik", price: 12_000, currency: "AZN", renewalMonths: 12 });
  const inv = await post("/docs", { kind: "invoice", contactId: c.id, currency: "AZN", lines: [{ productId: p.id, name: p.name, quantity: 1, unit: "ədəd", unitPrice: 12_000 }] });
  const sent = await post(`/docs/${inv.id}/send`, { email: false });
  await post(`/docs/${inv.id}/payments`, { amount: sent.doc.total, method: "cash", paidOn: today() });

  await page.goto("/sales/products");
  await page.getByRole("link", { name: "Yenilənmələr" }).click();
  await expect(page.getByRole("heading", { name: "Xidmət yenilənmələri" })).toBeVisible();
  await expect(page.getByText("Hosting illik")).toBeVisible();
  await page.getByRole("button", { name: "Yeniləndi" }).click();
  await expect(page.getByText("Hosting illik")).toHaveCount(0);

  // A company target for this month
  await page.locator("aside nav").getByRole("link", { name: "Hədəflər" }).click();
  await expect(page.getByRole("heading", { name: "Satış hədəfləri" })).toBeVisible();
  await page.getByRole("button", { name: "Hədəf qoy: Bütün şirkət" }).click();
  await page.getByLabel(/Hədəf məbləği/).fill("5000");
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(page.getByRole("progressbar", { name: "Bütün şirkət" })).toBeVisible();
  await page.locator("aside nav").getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Bu ayın hədəfi" })).toBeVisible();

  // Automation from a ready-made example
  await page.goto("/automations");
  await page.getByRole("button", { name: "Faktura ödənəndə satışı «Qazanıldı»-ya keçir" }).click();
  await expect(page.getByLabel("Nə vaxt")).toHaveValue("invoice.paid");
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(page.getByText("Satışı mərhələyə keçir: Qazanıldı")).toBeVisible();
});
