import { expect, test } from "@playwright/test";
import { navTo, PASSWORD, signupCompany, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

test("tasks: quick add → done → board drag → detail (subtask, comment, file)", async ({ page }) => {
  await signupCompany(page, "Tapşırıq MMC");
  await navTo(page, "Tapşırıqlar");
  await expect(page.getByText("Tapşırıq yoxdur")).toBeVisible();

  await page.getByLabel("Yeni tapşırıq").fill("Hesabatı hazırla");
  await page.getByLabel("Son tarix").fill("2020-01-10T10:00");
  await page.getByRole("button", { name: "Əlavə et", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Hesabatı hazırla" });
  await expect(row).toBeVisible();
  await expect(row.getByText("10 yan, 10:00")).toHaveClass(/text-danger/);

  await page.getByLabel("Yeni tapşırıq").fill("Müştəriyə zəng");
  await page.getByRole("button", { name: "Əlavə et", exact: true }).click();
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/v1/tasks/"));
  await page.getByRole("checkbox", { name: "Tamamlandı kimi işarələ: Müştəriyə zəng" }).click();
  await expect(page.getByRole("checkbox", { name: "Yenidən aç: Müştəriyə zəng" })).toBeChecked();
  expect((await saved).status()).toBe(200);
  await page.reload();
  // Finished tasks leave the default list
  await expect(page.getByText("Müştəriyə zəng")).toHaveCount(0);

  // Board: drag to "İcrada"
  await page.getByRole("link", { name: "Lövhə" }).click();
  const card = page.getByRole("region", { name: "Görüləcək" }).getByRole("listitem").filter({ hasText: "Hesabatı hazırla" });
  await card.dragTo(page.getByRole("region", { name: "İcrada" }), { sourcePosition: { x: 12, y: 8 } });
  await expect(page.getByRole("region", { name: "İcrada" }).getByText("Hesabatı hazırla")).toBeVisible();
  await expect(page.getByRole("region", { name: "Tamamlandı" }).getByText("Müştəriyə zəng")).toBeVisible();

  // Detail page
  await page.getByRole("link", { name: "Hesabatı hazırla" }).click();
  await page.getByLabel("Təsvir").fill("Q4 rəqəmləri ilə");
  await page.getByLabel("Təkrarlanma").selectOption({ label: "Hər həftə" });
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(page.getByRole("status")).toHaveText("Yadda saxlanıldı");

  await page.getByLabel("Alt tapşırıq əlavə et").fill("Rəqəmləri topla");
  await page.getByRole("button", { name: "Əlavə et", exact: true }).click();
  await page.getByRole("checkbox", { name: "Tamamlandı kimi işarələ: Rəqəmləri topla" }).click();
  await expect(page.getByText("1/1")).toBeVisible();

  await page.getByLabel("Şərhlər").fill("Cümə gününə hazır olacaq");
  await page.getByRole("button", { name: "Göndər" }).click();
  await expect(page.getByText("Cümə gününə hazır olacaq")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({ name: "hesabat-müqavilə.txt", mimeType: "text/plain", buffer: Buffer.from("Salam dünya") });
  const link = page.getByRole("link", { name: "hesabat-müqavilə.txt" });
  await expect(link).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("hesabat-müqavilə.txt");
  const body = await (await download.createReadStream()).toArray();
  expect(Buffer.concat(body).toString()).toBe("Salam dünya");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Faylı sil: hesabat-müqavilə.txt" }).click();
  await expect(page.getByText("Fayl yoxdur")).toBeVisible();
});

test("assigning a task notifies the employee via the bell; team profile shows it", async ({ page, browser }) => {
  await signupCompany(page, "Bildiriş MMC");
  await page.goto("/settings/members");
  await page.getByRole("button", { name: "İşçi dəvət et" }).click();
  await page.getByLabel("Email", { exact: true }).fill(uniqueEmail("emp"));
  await page.getByRole("button", { name: "Dəvət yarat" }).click();
  const link = await page.locator("input[readonly]").inputValue();

  const emp = await (await browser.newContext({ locale: "az-AZ", viewport: { width: 1920, height: 1080 } })).newPage();
  await emp.goto(link);
  await emp.getByLabel("Ad və soyad").fill("Nigar Qasımova");
  await emp.getByLabel("Şifrə").fill(PASSWORD);
  await emp.getByRole("button", { name: "Dəvəti qəbul et" }).click();
  await expect(emp.getByRole("heading", { name: "Salam, Nigar" })).toBeVisible();

  // Owner assigns a task to the new employee
  await page.goto("/tasks");
  await page.getByLabel("Yeni tapşırıq").fill("Anbarı yoxla");
  await page.getByLabel("Məsul").selectOption({ label: "Nigar Qasımova" });
  await page.getByRole("button", { name: "Əlavə et", exact: true }).click();
  await page.getByRole("link", { name: "Hamısı" }).click();
  await expect(page.getByText("Anbarı yoxla")).toBeVisible();

  await emp.reload();
  const bell = emp.getByRole("button", { name: "Bildirişlər 1" });
  await expect(bell).toBeVisible();
  await bell.click();
  await emp.getByText("Elvin Rzayev sizə tapşırıq verdi: Anbarı yoxla").click();
  await expect(emp.getByRole("heading", { name: "Anbarı yoxla" })).toBeVisible();
  await expect(emp.getByRole("button", { name: "Bildirişlər", exact: true })).toBeVisible();

  // Team page and profile
  await page.goto("/team");
  await page.getByRole("link", { name: /Nigar Qasımova/ }).click();
  await expect(page.getByRole("heading", { name: "Nigar Qasımova" })).toBeVisible();
  await expect(page.getByText("Anbarı yoxla")).toBeVisible();
});

test("contact card: add a reminder task linked to the customer", async ({ page }) => {
  await signupCompany(page, "Xatırlatma MMC");
  await page.goto("/crm/new");
  await page.getByLabel("Ad", { exact: true }).fill("Fərid Nəsirov");
  await page.getByRole("button", { name: "Yarat", exact: true }).click();
  await expect(page.getByText("Açıq tapşırıq yoxdur")).toBeVisible();
  await page.getByLabel("Yeni tapşırıq").fill("Fəridə geri zəng");
  await page.getByLabel("Son tarix").fill("2031-05-02T15:30");
  await page.getByRole("button", { name: "Əlavə et", exact: true }).click();
  await expect(page.getByRole("link", { name: "Fəridə geri zəng" })).toBeVisible();
  await expect(page.getByText("2 may, 15:30")).toBeVisible();
  await page.getByRole("link", { name: "Fəridə geri zəng" }).click();
  await expect(page.getByRole("link", { name: "Fərid Nəsirov" })).toBeVisible();
});
