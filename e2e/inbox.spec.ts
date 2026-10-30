import { expect, test } from "@playwright/test";
import { navTo, signupCompany } from "./helpers";

test.describe.configure({ mode: "serial" });

test("website chat: embedded widget → live inbox → reply and internal note → visitor sees only the reply", async ({ page, browser }) => {
  await signupCompany(page, "Widget MMC");
  await navTo(page, "Mesajlar");
  await page.getByRole("link", { name: "Kanalları qoşun" }).click();
  await page.getByRole("button", { name: "Sayt çatı" }).click();
  await page.getByLabel("Salamlama mətni").fill("Salam! Sualınızı yazın.");
  await page.getByRole("button", { name: "Qoş", exact: true }).click();
  const code = await page.getByLabel(/Saytınıza bu kodu/).inputValue();
  const src = /src="([^"]+)"/.exec(code)![1]!.replace("http://localhost:3000", process.env.E2E_BASE_URL ?? "http://localhost:3000");
  const key = /data-axis-widget="([^"]+)"/.exec(code)![1]!;

  // Agent keeps the inbox open: the conversation must appear without a reload (SSE)
  await page.goto("/inbox");
  await expect(page.getByText("Canlı")).toBeVisible();

  // A customer's website on another origin embeds the script
  const visitor = await (await browser.newContext({ locale: "az-AZ" })).newPage();
  await visitor.setContent(`<html><body><h1>Müştəri saytı</h1><script src="${src}" data-axis-widget="${key}"></script></body></html>`);
  await visitor.getByRole("button", { name: "Chat" }).click();
  const chat = visitor.frameLocator('iframe[title="Chat"]');
  await expect(chat.getByText("Salam! Sualınızı yazın.")).toBeVisible();
  await chat.getByLabel("Adınız (istəyə bağlı)").fill("Leyla");
  await chat.getByLabel("Mesajınızı yazın…").fill("Qiymətlər nə qədərdir?");
  await chat.getByRole("button", { name: "Göndər" }).click();
  await expect(chat.getByText("Qiymətlər nə qədərdir?")).toBeVisible();

  const item = page.getByRole("link", { name: /Leyla/ });
  await expect(item).toBeVisible();
  await expect(item.getByText("Təyin olunmayıb")).toBeVisible();
  await item.click();

  await page.getByRole("tab", { name: "Daxili qeyd" }).click();
  await page.getByRole("textbox", { name: "Daxili qeyd" }).fill("VIP müştəridir, endirim təklif et");
  await page.getByRole("button", { name: "Qeyd əlavə et" }).click();
  await expect(page.getByText("VIP müştəridir, endirim təklif et")).toBeVisible();

  await page.getByRole("tab", { name: "Müştəriyə cavab" }).click();
  await page.getByRole("textbox", { name: "Müştəriyə cavab" }).fill("Salam Leyla! Paketlər 39 ₼-dan başlayır.");
  await page.getByRole("button", { name: "Göndər" }).click();
  await expect(page.getByText("Salam Leyla! Paketlər 39 ₼-dan başlayır.")).toBeVisible();
  // Replying claims the conversation
  await expect(page.getByRole("combobox", { name: "Məsul" }).last()).not.toHaveValue("");

  // Visitor gets the reply via polling — never the internal note
  await expect(chat.getByText("Salam Leyla! Paketlər 39 ₼-dan başlayır.")).toBeVisible({ timeout: 10_000 });
  await expect(chat.getByText("VIP müştəridir")).toHaveCount(0);

  // Add the visitor to the CRM, then resolve
  await page.getByRole("button", { name: "CRM-ə əlavə et" }).click();
  await expect(page.getByRole("link", { name: "Müştəri kartı →" })).toBeVisible();
  await page.getByRole("button", { name: "Həll edildi" }).click();
  await expect(page.getByRole("button", { name: "Yenidən aç" })).toBeVisible();
});

test("demo WhatsApp channel: simulated message, canned reply shortcut, demo delivery label", async ({ page }) => {
  await signupCompany(page, "Demo WA MMC");
  await page.goto("/settings/channels");
  await page.getByLabel("Qısa yol").fill("/salam");
  await page.getByLabel("Mətn", { exact: true }).fill("Salam! Necə kömək edək?");
  await page.getByRole("button", { name: "Əlavə et", exact: true }).click();
  await expect(page.getByText("Salam! Necə kömək edək?")).toBeVisible();

  await page.getByRole("button", { name: "WhatsApp" }).click();
  await expect(page.getByLabel("Demo rejimi (açarsız, mesajlar heç yerə göndərilmir)")).toBeChecked();
  await page.getByRole("button", { name: "Qoş", exact: true }).click();
  await expect(page.getByText("Demo", { exact: true })).toBeVisible();
  await page.getByLabel("Kimdən (nömrə və ya ad)").fill("+994 50 111 22 33");
  await page.getByLabel(/^Mesaj: /).fill("Sifarişim haradadır?");
  await page.getByRole("button", { name: "Gələn mesaj yarat" }).click();
  await expect(page.getByText("Mesaj yaradıldı")).toBeVisible();

  await navTo(page, "Mesajlar");
  await page.getByRole("link", { name: /\+994 50 111 22 33/ }).click();
  await page.getByRole("textbox", { name: "Müştəriyə cavab" }).pressSequentially("/salam ");
  await expect(page.getByRole("textbox", { name: "Müştəriyə cavab" })).toHaveValue("Salam! Necə kömək edək?");
  await page.getByRole("button", { name: "Göndər" }).click();
  await expect(page.getByText("Demo — göndərilmir")).toBeVisible();
});

test("dashboard shows the real inbox — no demo badges left", async ({ page }) => {
  await signupCompany(page, "Təmiz MMC");
  await expect(page.getByText("Cavab gözləyən mesajlar")).toBeVisible();
  await expect(page.getByText("Demo", { exact: true })).toHaveCount(0);
});
