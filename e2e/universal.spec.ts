import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

test("sections and words: hide a section, rename customers; help and simple mode", async ({ page }) => {
  await signupCompany(page, "Bölmə MMC");
  const menu = page.getByRole("complementary", { name: "Əsas menyu" });
  await expect(menu.getByRole("link", { name: "Marketinq" })).toBeVisible();

  await page.goto("/settings/workspace");
  await page.getByRole("checkbox", { name: "Marketinq" }).uncheck();
  await page.getByRole("textbox", { name: "Müştərilər (menyu)" }).fill("Tələbələr");
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(page.getByRole("status")).toHaveText("Yadda saxlandı");
  await expect(menu.getByRole("link", { name: "Marketinq" })).toBeHidden();
  await expect(menu.getByRole("link", { name: "Tələbələr" })).toBeVisible();
  // The page itself still opens (nothing is lost)
  await page.goto("/campaigns");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Help for the page, and simple mode trims the menu
  await page.goto("/crm");
  await page.getByRole("button", { name: "Kömək" }).click();
  await expect(page.getByRole("dialog", { name: "Bu səhifədə" })).toContainText("Excel");
  await page.keyboard.press("Escape");
  await expect(menu.getByRole("link", { name: "Avtomatlaşdırma" })).toBeVisible();
  await menu.getByRole("button", { name: "Sadə rejim" }).click();
  await expect(menu.getByRole("link", { name: "Avtomatlaşdırma" })).toBeHidden();
  await expect(menu.getByRole("link", { name: "Tələbələr" })).toBeVisible();
});

test("integrations: an API key shown once, an incoming address for website forms", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "İnteqrasiya MMC");
  await page.goto("/settings/integrations");
  await page.getByRole("textbox", { name: "Açarın adı" }).fill("Sayt");
  await page.getByRole("button", { name: "Açar yarat" }).click();
  const shown = page.getByRole("status").filter({ hasText: "Açar yaradıldı" });
  await expect(shown.locator("code")).toContainText("axk_");
  await expect(page.getByRole("button", { name: "Ləğv et: Sayt" })).toBeVisible();

  const inbound = page.locator("#inbound");
  await inbound.getByRole("textbox", { name: "Ad" }).fill("Tilda formu");
  await inbound.getByRole("button", { name: "Ünvan yarat" }).click();
  await expect(inbound.getByLabel("Ünvan")).toContainText("/api/v1/public/in/");
  await expect(page.getByText("İşləyir").first()).toBeVisible();
});

test("custom section: define it, add a record, find it in the menu; save a list view", async ({ page }) => {
  await signupCompany(page, "Bölmələr MMC");
  await page.goto("/settings/workspace");
  await page.getByRole("button", { name: "Bölmə yarat" }).click();
  await page.getByRole("textbox", { name: "Bölmənin adı" }).fill("Avtomobillər");
  await page.getByRole("textbox", { name: "Bir qeyd necə adlanır" }).fill("Avtomobil");
  await page.getByRole("textbox", { name: "Sahənin adı" }).fill("Marka");
  await page.getByRole("button", { name: "Bölmə yarat" }).click();
  await expect(page.getByText("0 qeyd · Marka")).toBeVisible();

  const menu = page.getByRole("complementary", { name: "Əsas menyu" });
  await menu.getByRole("link", { name: "Avtomobillər" }).click();
  await page.getByRole("link", { name: "Yeni: Avtomobil" }).first().click();
  await page.getByRole("textbox", { name: "Ad *", exact: true }).fill("90-AA-001");
  await page.getByRole("textbox", { name: "Marka" }).fill("Kia");
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(page.getByRole("link", { name: "90-AA-001" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kia" })).toBeVisible();

  // A filtered customer list saved under a name
  await page.goto("/crm?level=hot");
  await page.getByRole("button", { name: "Bu filtri saxla" }).click();
  await page.getByRole("textbox", { name: "Görünüşün adı" }).fill("İsti lidlər");
  await page.getByRole("button", { name: "Saxla", exact: true }).click();
  await expect(page.getByRole("link", { name: "İsti lidlər" })).toHaveAttribute("aria-current", "true");
  await page.goto("/crm");
  await page.getByRole("link", { name: "İsti lidlər" }).click();
  await expect(page).toHaveURL(/level=hot/);
});
