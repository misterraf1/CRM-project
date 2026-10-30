import { expect, test } from "@playwright/test";
import { navTo, signupCompany } from "./helpers";

test("import people from CSV, then export the list", async ({ page }) => {
  await signupCompany(page, "Import MMC");
  await navTo(page, "Müştərilər");
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Import", exact: true })).toBeVisible();

  const csv = ["Ad soyad;E-poçt;Telefon;Qeyd", "Aysel Məmmədova;aysel@x.az;+994501234567;vip", "Kamran;kamran@x;;", "Leyla Əliyeva;leyla@x.az;;"].join("\n");
  await page.getByLabel("Fayl", { exact: true }).setInputFiles({ name: "musteriler.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Faylı oxu" }).click();

  // Columns recognised from their Azerbaijani names; the unknown one is left out
  await expect(page.getByRole("combobox", { name: "Sahə: E-poçt" })).toHaveValue("email");
  await expect(page.getByRole("combobox", { name: "Sahə: Qeyd" })).toHaveValue("");
  await expect(page.getByText("Sətir 3")).toBeVisible();
  await expect(page.getByText("Email: Email düzgün deyil «kamran@x»")).toBeVisible();

  // Mapping the extra column to tags makes the result stale until checked again
  await page.getByRole("combobox", { name: "Sahə: Qeyd" }).selectOption("tags");
  await expect(page.getByRole("button", { name: "Import et" })).toBeHidden();
  await page.getByRole("button", { name: "Yoxla" }).click();
  await page.getByRole("button", { name: "Import et" }).click();

  await expect(page.getByRole("heading", { name: "Import tamamlandı" })).toBeVisible();
  const history = page.locator("section", { hasText: "Import tarixçəsi" });
  await expect(history.getByText("musteriler.csv")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Import olunmayan sətirləri yüklə", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("musteriler-issues.csv");

  await page.getByRole("link", { name: "Müştərilər", exact: true }).last().click();
  await expect(page.getByRole("link", { name: /Aysel Məmmədova/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Leyla Əliyeva/ })).toBeVisible();

  await page.getByText("Export", { exact: true }).click();
  const exported = page.waitForEvent("download");
  await page.getByRole("link", { name: "Excel (.xlsx)" }).click();
  expect((await exported).suggestedFilename()).toMatch(/^customers-\d{4}-\d{2}-\d{2}\.xlsx$/);
});
