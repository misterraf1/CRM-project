import { expect, test } from "@playwright/test";
import { navTo, signupCompany } from "./helpers";

test.describe.configure({ mode: "serial" });

test("custom fields, company link, second pipeline and a USD deal", async ({ page }) => {
  await signupCompany(page, "Ayarlar MMC");

  // A required choice field for people, a tax id for companies
  await page.goto("/settings/crm");
  await expect(page.getByRole("heading", { name: "CRM ayarları" })).toBeVisible();
  await page.getByRole("button", { name: "Sahə əlavə et" }).click();
  await page.getByLabel("Sahənin adı").fill("Filial");
  await page.getByLabel("Növ").selectOption("select");
  await page.getByLabel("Seçimlər").fill("Bakı\nGəncə");
  await page.getByLabel("Məcburi").check();
  await page.getByRole("button", { name: "Yadda saxla" }).first().click();
  await expect(page.getByText("Siyahı (bir seçim) · Bakı, Gəncə")).toBeVisible();

  await page.getByRole("tab", { name: "Şirkətlər" }).click();
  await page.getByRole("button", { name: "Sahə əlavə et" }).click();
  await page.getByLabel("Sahənin adı").fill("VÖEN");
  await page.getByRole("button", { name: "Yadda saxla" }).first().click();
  await expect(page.getByRole("listitem").getByText("VÖEN", { exact: true })).toBeVisible();

  // USD rate, then a second pipeline with its own stage
  await page.getByLabel("1 USD = ? AZN").fill("1,7");
  await page.locator("section", { hasText: "Valyutalar" }).getByRole("button", { name: "Yadda saxla" }).click();
  await expect(page.locator("section", { hasText: "Valyutalar" }).getByRole("status")).toHaveText("Yadda saxlanıldı");

  await page.getByPlaceholder("Prosesin adı").fill("Topdan");
  await page.getByRole("button", { name: "Proses əlavə et" }).click();
  await expect(page.getByRole("tab", { name: "Topdan" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Mərhələ əlavə et" }).click();
  await page.getByLabel("Mərhələ", { exact: true }).nth(4).fill("Nümunə");
  await page.getByRole("button", { name: "Mərhələləri yadda saxla" }).click();
  await expect(page.locator("section", { hasText: "Satış prosesləri" }).getByRole("status")).toHaveText("Yadda saxlanıldı");

  // Company with its tax id, then a person linked to it (required branch enforced)
  await navTo(page, "Müştərilər");
  await page.getByRole("link", { name: "Yeni müştəri" }).click();
  await page.getByRole("radio", { name: "Şirkət" }).click();
  await page.getByLabel("Ad", { exact: true }).fill("Araz MMC");
  await page.getByLabel("VÖEN").fill("1400123456");
  await page.getByRole("button", { name: "Yarat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Araz MMC" })).toBeVisible();
  await expect(page.getByText("Bu şirkətə hələ şəxs bağlanmayıb")).toBeVisible();

  await page.getByRole("link", { name: "Şəxs əlavə et" }).click();
  await expect(page.getByLabel("Şirkət", { exact: true })).toHaveValue("Araz MMC");
  await page.getByLabel("Ad", { exact: true }).fill("Aysel Məmmədova");
  await page.getByLabel(/Filial/).selectOption("Gəncə");
  await page.getByLabel("Etiketlər").fill("vip, topdan");
  await page.getByRole("button", { name: "Yarat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aysel Məmmədova" })).toBeVisible();
  await page.getByRole("link", { name: "Araz MMC" }).first().click();
  await expect(page.locator("section", { hasText: "Əlaqəli şəxslər" }).getByRole("link", { name: /Aysel Məmmədova/ })).toBeVisible();

  // Filter by the custom field
  await page.goto("/crm");
  await page.getByLabel("Əlavə sahə").selectOption({ label: "Filial" });
  await page.getByLabel("Dəyər").fill("Bakı");
  await page.getByRole("button", { name: "Ad, email, telefon və ya şirkət" }).click();
  await expect(page.getByText("Müştəri tapılmadı")).toBeVisible();
  await page.getByLabel("Dəyər").fill("Gəncə");
  await page.getByRole("button", { name: "Ad, email, telefon və ya şirkət" }).click();
  await expect(page.getByRole("link", { name: /Aysel Məmmədova/ })).toBeVisible();

  // Deal on the second pipeline, switched to USD: the board total is in AZN
  await navTo(page, "Satışlar");
  await page.getByRole("link", { name: "Topdan", exact: true }).click();
  await expect(page.getByRole("link", { name: "Topdan", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Yeni satış" }).click();
  await page.getByPlaceholder("Satışın adı").fill("Topdan sifariş");
  await page.getByPlaceholder("Məbləğ").fill("1000");
  await page.getByRole("button", { name: "Yarat", exact: true }).click();
  await page.getByRole("link", { name: "Topdan sifariş" }).click();
  await page.getByLabel("Valyuta").selectOption("USD");
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(page.getByText("≈ 1.700 ₼")).toBeVisible();
  await page.goto("/deals");
  await page.getByRole("link", { name: "Topdan", exact: true }).click();
  await expect(page.getByRole("link", { name: "Topdan", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Yeni", exact: true }).getByText("1 satış · 1.700 ₼")).toBeVisible();
});
