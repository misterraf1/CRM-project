import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku" }).format(new Date());

test("calendar: plan a meeting with a customer, see it in month and week views, record the outcome", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Təqvim MMC");
  const origin = new URL(page.url()).origin;
  const c = await (await page.request.post("/api/v1/contacts", { data: { name: "Leyla Hüseynova", phone: "+994551112233" }, headers: { origin } })).json();

  await page.locator("aside nav").getByRole("link", { name: "Təqvim" }).click();
  await expect(page.getByRole("heading", { name: "Təqvim", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Yeni hadisə" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni hadisə" });
  await dialog.getByLabel("Ad").fill("Layihə təqdimatı");
  await dialog.getByRole("combobox", { name: "Müştəri" }).fill("Leyla");
  await dialog.getByRole("option", { name: "Leyla Hüseynova" }).click();
  await dialog.getByLabel("Yer və ya link").fill("Ofis, 3-cü mərtəbə");
  await dialog.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(dialog).toHaveCount(0);

  const chip = page.getByRole("button", { name: /Layihə təqdimatı/ }).first();
  await expect(chip).toBeVisible();
  await page.getByRole("link", { name: "Həftə" }).click();
  await expect(page.getByRole("link", { name: "Həftə" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: /Layihə təqdimatı/ }).first().click();
  const edit = page.getByRole("dialog", { name: "Layihə təqdimatı" });
  await expect(edit.getByText("Leyla Hüseynova")).toBeVisible();
  await edit.getByRole("button", { name: "Baş tutdu" }).click();
  await expect(edit).toHaveCount(0);

  // The meeting is on the customer's card and timeline
  await page.goto(`/crm/${c.id}`);
  const calls = page.getByRole("region", { name: "Zənglər və görüşlər" });
  await expect(calls.getByText("Layihə təqdimatı")).toBeVisible();
  await expect(calls.getByText("Baş tutdu")).toBeVisible();
  await expect(page.getByText(/«Layihə təqdimatı» görüşünü qeyd etdi: Baş tutdu/)).toBeVisible();
});

test("call log on the contact card, and the Today page gathers the day's work", async ({ page }) => {
  await signupCompany(page, "Bu gün MMC");
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: object) => (await page.request.post(`/api/v1${path}`, { data, headers: { origin } })).json();
  const c = await post("/contacts", { name: "Orxan Quliyev", phone: "+994501110022" });
  await post("/tasks", { title: "Dünən bitməli idi", dueAt: new Date(Date.now() - 30 * 3_600_000).toISOString() });

  await page.goto(`/crm/${c.id}`);
  const calls = page.getByRole("region", { name: "Zənglər və görüşlər" });
  await expect(calls.getByRole("link", { name: "+994501110022" })).toHaveAttribute("href", "tel:+994501110022");
  await calls.getByRole("button", { name: "Zəngi qeyd et" }).click();
  await calls.getByLabel("Nəticə").selectOption("callback");
  await calls.getByLabel("Müddət (dəq)").fill("4");
  await calls.getByLabel("Qeyd").fill("Sabah qiymət soruşacaq");
  await calls.getByRole("button", { name: "Yadda saxla" }).click();
  await expect(calls.getByText("Sabah qiymət soruşacaq")).toBeVisible();
  await expect(calls.getByText("Geri zəng lazımdır")).toBeVisible();
  await expect(page.getByText(/zəng qeyd etdi: Geri zəng lazımdır/)).toBeVisible();

  await page.locator("aside nav").getByRole("link", { name: "Bu gün" }).click();
  await expect(page.getByRole("heading", { name: "Bu gün", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Gecikən tapşırıqlar" }).getByText("Dünən bitməli idi")).toBeVisible();
  await expect(page.getByRole("region", { name: "Geri zəng gözləyənlər" }).getByText("Orxan Quliyev")).toBeVisible();

  // Day view of the calendar from Today
  await page.getByRole("link", { name: "Təqvimi aç" }).click();
  await expect(page).toHaveURL(new RegExp(`view=day&date=${todayKey()}`));
});
