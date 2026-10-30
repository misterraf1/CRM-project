import { expect, test } from "@playwright/test";
import { signupCompany, uniqueEmail } from "./helpers";

test("owner creates a custom role from a built-in one and invites a member with it", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Rol MMC");
  await page.goto("/settings/roles");
  await expect(page.getByRole("heading", { name: "Rollar", exact: true })).toBeVisible();

  // Built-in roles are reference only
  await page.getByRole("button", { name: /^İşçi/ }).click();
  await expect(page.getByRole("checkbox", { name: "Müştəri yaratmaq" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Müştəri yaratmaq" })).toBeDisabled();

  // Copy it into an own role without creating contacts
  await page.getByRole("button", { name: "Köçürüb öz rolunu yarat" }).click();
  await page.getByLabel("Rolun adı").fill("Müşahidəçi");
  await page.getByLabel("Təsvir").fill("Yalnız baxır");
  await page.getByRole("checkbox", { name: "Müştəri yaratmaq" }).uncheck();
  // Billing is never part of a role
  await expect(page.getByRole("checkbox", { name: /Abunəlik və ödəniş/ })).toBeDisabled();
  await page.getByRole("button", { name: "Rolu yarat" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Yadda saxlanıldı." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Müşahidəçi\s+0 işçi/ })).toBeVisible();

  // The members screen offers it; the invited member carries it
  await page.getByRole("link", { name: "İşçilər", exact: true }).click();
  await page.getByRole("button", { name: "İşçi dəvət et" }).click();
  const email = uniqueEmail("viewer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator("select[name=role]").selectOption({ label: "Müşahidəçi" });
  await page.getByRole("button", { name: "Dəvət yarat" }).click();
  await expect(page.getByText("Dəvət linki hazırdır")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row.getByRole("combobox").first()).toHaveValue(/^custom:/);
  await expect(row.getByRole("combobox").first().locator("option:checked")).toHaveText("Müşahidəçi");

  // In use: it can't be deleted
  await page.getByRole("link", { name: "Rollar", exact: true }).click();
  await page.getByRole("button", { name: /Müşahidəçi\s+1 işçi/ }).click();
  await expect(page.getByRole("button", { name: "Sil" })).toBeDisabled();
});
