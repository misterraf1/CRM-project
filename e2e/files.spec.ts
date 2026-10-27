import { expect, test } from "@playwright/test";
import { navTo, signupCompany } from "./helpers";

test("files: upload to the shared library, filter, download, delete", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Fayl MMC");
  await navTo(page, "Fayllar");
  await expect(page.getByRole("heading", { name: "Fayllar" })).toBeVisible();
  await expect(page.getByText("Fayl yoxdur")).toBeVisible();

  await page.getByLabel("Fayl yüklə").setInputFiles({ name: "daxili-qaydalar.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  const row = page.getByRole("row").filter({ hasText: "daxili-qaydalar.pdf" });
  await expect(row).toContainText("Ümumi sənədlər");
  await expect(row).toContainText("Elvin Rzayev");

  await page.getByRole("main").getByRole("link", { name: "Tapşırıqlar" }).click();
  await expect(page.getByText("Fayl yoxdur")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Hamısı" }).click();

  const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("link", { name: /^Yüklə:/ }).click()]);
  expect(download.suggestedFilename()).toBe("daxili-qaydalar.pdf");

  await row.getByRole("button", { name: /^Sil:/ }).click();
  await expect(page.getByText("Fayl yoxdur")).toBeVisible();
});
