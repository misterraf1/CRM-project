import { expect, test, type Browser, type Page } from "@playwright/test";
import { navTo, PASSWORD, signupCompany, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

/** Owner invites a colleague; returns the colleague's logged-in page. */
async function inviteColleague(page: Page, browser: Browser, fullName: string) {
  await page.goto("/settings/members");
  await page.getByRole("button", { name: "İşçi dəvət et" }).click();
  await page.getByLabel("Email", { exact: true }).fill(uniqueEmail("chat"));
  await page.getByRole("button", { name: "Dəvət yarat" }).click();
  const link = await page.locator("input[readonly]").inputValue();
  const other = await (await browser.newContext({ locale: "az-AZ", viewport: { width: 1440, height: 900 } })).newPage();
  await other.goto(link);
  await other.getByLabel("Ad və soyad").fill(fullName);
  await other.getByLabel("Şifrə").fill(PASSWORD);
  await other.getByRole("button", { name: "Dəvəti qəbul et" }).click();
  await expect(other.getByRole("heading", { name: `Salam, ${fullName.split(" ")[0]}` })).toBeVisible();
  return other;
}

test("direct chat in real time, unread badge, edit/delete, file, task link and convert", async ({ page, browser }) => {
  await signupCompany(page, "Çat MMC");
  const nigar = await inviteColleague(page, browser, "Nigar Qasımova");

  // Owner opens a direct chat with Nigar
  await navTo(page, "Komanda çatı");
  await expect(page.getByText("Yalnız komanda daxili")).toBeVisible();
  await page.getByRole("button", { name: "Həmkara yaz" }).click();
  await page.getByLabel("Həmkar seçin").selectOption({ label: "Nigar Qasımova" });
  await page.getByRole("button", { name: "Aç", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nigar Qasımova" })).toBeVisible();

  // Nigar keeps the chat list open; the message arrives live with an unread badge
  await nigar.goto("/chat");
  await expect(nigar.getByText("Canlı")).toBeVisible();
  await page.getByLabel(/Mesaj yazın/).fill("Salam Nigar, hesabat hazırdır?");
  await page.getByLabel(/Mesaj yazın/).press("Enter");
  await expect(page.getByText("Salam Nigar, hesabat hazırdır?")).toBeVisible();
  const roomLink = nigar.getByRole("link", { name: /Elvin Rzayev/ });
  await expect(roomLink.getByText("1", { exact: true })).toBeVisible();
  await expect(nigar.locator("aside nav").getByRole("link", { name: /^Komanda çatı 1$/ })).toBeVisible();

  await roomLink.click();
  await expect(nigar.getByText("Salam Nigar, hesabat hazırdır?")).toBeVisible();
  await expect(nigar.locator("aside nav").getByRole("link", { name: /^Komanda çatı$/ })).toBeVisible();

  // Nigar replies and links one of her tasks
  const roomUrl = nigar.url();
  await nigar.goto("/tasks");
  await nigar.getByLabel("Yeni tapşırıq").fill("Aylıq hesabat");
  await nigar.getByRole("button", { name: "Əlavə et", exact: true }).click();
  await expect(nigar.getByRole("link", { name: "Aylıq hesabat" })).toBeVisible();
  await nigar.goto(roomUrl);
  await nigar.getByLabel("Tapşırıq bağla").selectOption({ label: "Aylıq hesabat" });
  await nigar.getByLabel(/Mesaj yazın/).fill("Bəli, budur");
  await nigar.getByRole("button", { name: "Göndər" }).click();
  await expect(nigar.getByRole("link", { name: /Aylıq hesabat · Görüləcək/ })).toBeVisible();
  // The owner sees the link too (owners see all tasks)
  await expect(page.getByRole("link", { name: /Aylıq hesabat · Görüləcək/ })).toBeVisible();

  // File message
  await page.locator('input[type="file"]').setInputFiles({ name: "qiymət-cədvəli.txt", mimeType: "text/plain", buffer: Buffer.from("1;2;3") });
  await expect(page.getByRole("link", { name: "qiymət-cədvəli.txt" })).toBeVisible();
  await expect(nigar.getByRole("link", { name: "qiymət-cədvəli.txt" })).toBeVisible();

  // Edit and delete own message
  const mine = page.locator(".group").filter({ hasText: "Salam Nigar, hesabat hazırdır?" });
  await mine.hover();
  await mine.getByRole("button", { name: "Redaktə et" }).click();
  await page.getByRole("textbox", { name: "Redaktə et" }).fill("Salam Nigar, aylıq hesabat hazırdır?");
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(nigar.getByText("Salam Nigar, aylıq hesabat hazırdır?")).toBeVisible();
  await expect(nigar.getByText(/redaktə edilib/)).toBeVisible();

  // Turn Nigar's message into a task
  const theirs = page.locator(".group").filter({ hasText: "Bəli, budur" });
  await theirs.hover();
  await theirs.getByRole("button", { name: /Tapşırığa çevir/ }).click();
  await expect(page.getByText("Tapşırıq yaradıldı")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  const edited = page.locator(".group").filter({ hasText: "aylıq hesabat hazırdır?" });
  await edited.hover();
  await edited.getByRole("button", { name: "Sil" }).click();
  await expect(nigar.getByText("Salam Nigar, aylıq hesabat hazırdır?")).toHaveCount(0);

  // Search across my rooms
  await nigar.getByLabel("Mesajlarda axtar").fill("budur");
  await nigar.getByLabel("Mesajlarda axtar").press("Enter");
  await expect(nigar.getByText("Axtarış nəticələri")).toBeVisible();
  await expect(nigar.getByRole("link", { name: /Bəli, budur/ })).toBeVisible();
});

test("group chat: create with members, add member, leave", async ({ page, browser }) => {
  await signupCompany(page, "Qrup MMC");
  const tural = await inviteColleague(page, browser, "Tural Məmmədov");
  const leyla = await inviteColleague(page, browser, "Leyla Abbasova");

  await page.goto("/chat");
  await page.getByRole("button", { name: "Yeni qrup" }).click();
  await page.getByLabel("Qrupun adı").fill("Layihə X");
  await page.getByLabel("Tural Məmmədov").check();
  await page.getByRole("button", { name: "Yarat" }).click();
  await expect(page.getByRole("heading", { name: "Layihə X" })).toBeVisible();
  await page.getByLabel(/Mesaj yazın/).fill("Xoş gəldiniz!");
  await page.getByLabel(/Mesaj yazın/).press("Enter");

  await tural.goto("/chat");
  await expect(tural.getByRole("link", { name: /Layihə X/ })).toBeVisible();
  await leyla.goto("/chat");
  await expect(leyla.getByRole("link", { name: /Layihə X/ })).toHaveCount(0);

  await page.getByLabel("Üzv əlavə et").selectOption({ label: "Leyla Abbasova" });
  await expect(page.getByText("Qrup · 3 üzv")).toBeVisible();
  await leyla.reload();
  await leyla.getByRole("link", { name: /Layihə X/ }).click();
  await expect(leyla.getByText("Xoş gəldiniz!")).toBeVisible();

  leyla.once("dialog", (d) => d.accept());
  await leyla.getByRole("button", { name: "Qrupdan çıx" }).click();
  await expect(leyla.getByRole("link", { name: /Layihə X/ })).toHaveCount(0);
});
