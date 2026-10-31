import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date());

test("getting started: sample data in and out, a business template, the checklist", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Başlanğıc MMC");
  const card = page.getByRole("region", { name: "Başlanğıc addımları" });
  await expect(card.getByText("0/7 hazırdır", { exact: false })).toBeVisible();
  await card.getByRole("button", { name: "Nümunə məlumat əlavə et" }).click();
  await expect(card.getByRole("button", { name: "Nümunə məlumatı sil" })).toBeVisible();
  await page.goto("/crm");
  await expect(page.getByText("Aynur Həsənova")).toBeVisible();
  await page.goto("/dashboard");
  await page.getByRole("region", { name: "Başlanğıc addımları" }).getByRole("button", { name: "Nümunə məlumatı sil" }).click();
  await expect(page.getByRole("region", { name: "Başlanğıc addımları" }).getByRole("button", { name: "Nümunə məlumat əlavə et" })).toBeVisible();

  await page.getByRole("region", { name: "Başlanğıc addımları" }).getByRole("button", { name: "Biznes şablonu seçin" }).click();
  await page.getByRole("button", { name: "Tətbiq et: Sifarişli istehsal" }).click();
  await expect(page.getByText(/Şablon əlavə olundu: 3 sahə, 2 məhsul/)).toBeVisible();
  await page.goto("/settings/crm");
  await expect(page.getByText("Sifarişli istehsal").first()).toBeVisible();
  await expect(page.getByText("Tətbiq olundu")).toBeVisible();
});

test("reports: receivables with ageing, a custom range saved as a view, the contract printout", async ({ page }) => {
  await signupCompany(page, "Hesabat MMC");
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: object, method: "post" | "patch" = "post") => (await page.request[method](`/api/v1${path}`, { data, headers: { origin } })).json();
  const c = await post("/contacts", { name: "Borclu Elmir" });
  const inv = await post("/docs", { kind: "invoice", contactId: c.id, currency: "AZN", lines: [{ name: "Mebel", quantity: 1, unit: "dəst", unitPrice: 100_000 }] });
  await post(`/docs/${inv.id}/send`, { email: false });
  await post("/settings/documents", { contractTemplate: "{company} ilə {customer} arasında {number} üzrə müqavilə." }, "patch");

  await page.goto("/analytics");
  const debts = page.getByRole("region", { name: "Debitor borcları" });
  await expect(debts.getByText("Borclu Elmir")).toBeVisible();
  await expect(page.getByRole("region", { name: "Məhsul və xidmətlər üzrə satış" }).getByText("Mebel")).toBeVisible();
  await page.getByLabel("Başlanğıc").fill(`${today().slice(0, 7)}-01`);
  await page.getByLabel("Son").fill(today());
  await page.getByRole("button", { name: "Göstər" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01&to=/);
  await page.getByRole("button", { name: "Hesabatı saxla" }).click();
  await page.getByLabel("Hesabatın adı").fill("Bu ay");
  await page.getByRole("button", { name: "Saxla", exact: true }).click();
  await expect(page.getByRole("list", { name: "Saxlanmış hesabatlar" }).getByRole("link", { name: "Bu ay" })).toBeVisible();

  await page.goto(`/sales/${inv.id}`);
  await page.getByRole("link", { name: "Müqavilə" }).click();
  await expect(page.getByText(/Hesabat MMC ilə Borclu Elmir arasında F-\d{4}-\d{4} üzrə müqavilə\./)).toBeVisible();
});

test("platform staff see usage per company", async ({ browser }) => {
  const admin = await (await browser.newContext({ locale: "az-AZ", viewport: { width: 1440, height: 900 } })).newPage();
  await admin.goto("/admin/login");
  await admin.getByLabel("Email").fill("platform@demo.axis");
  await admin.getByLabel("Şifrə").fill("demo12345");
  await admin.getByRole("button", { name: "Daxil ol" }).click();
  await admin.getByRole("navigation", { name: "Platforma idarəsi" }).getByRole("link", { name: "İstifadə" }).click();
  await expect(admin.getByRole("heading", { name: "Şirkətlər üzrə istifadə" })).toBeVisible();
  await expect(admin.getByRole("columnheader", { name: "Yaddaş, MB" })).toBeVisible();
});
