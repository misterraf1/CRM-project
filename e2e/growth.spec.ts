import { expect, test } from "@playwright/test";
import { recordTab, signupCompany } from "./helpers";

test("website form: built in settings, filled in by a visitor, the lead lands in the CRM", async ({ page, browser }) => {
  await signupCompany(page, "Forma MMC");
  await page.goto("/settings/forms");
  await page.getByRole("button", { name: "Yeni forma" }).click();
  await page.getByLabel("Formanın başlığı (saytda görünür)").fill("Pulsuz məsləhət");
  await page.getByRole("checkbox", { name: "Şirkət" }).check();
  await page.getByRole("button", { name: "Yadda saxla" }).click();
  const link = await page.getByRole("textbox", { name: "Formanın linki" }).inputValue();
  expect(link).toContain("/f/");
  await expect(page.getByRole("textbox", { name: "Sayta yerləşdirmə kodu" })).toHaveValue(/<iframe src=/);

  const visitor = await (await browser.newContext({ locale: "az-AZ" })).newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole("heading", { name: "Pulsuz məsləhət" })).toBeVisible();
  await visitor.getByLabel("Ad").fill("Lalə Məmmədova");
  await visitor.getByLabel("Telefon").fill("+994 55 444 33 22");
  await visitor.getByLabel("Şirkət").fill("Lalə Dizayn");
  await visitor.getByRole("button", { name: "Göndər" }).click();
  await expect(visitor.getByRole("status")).toContainText("Təşəkkürlər");

  await page.goto("/crm?source=website");
  await page.getByRole("link", { name: /Lalə Məmmədova/ }).click();
  await expect(page.getByText(/«Saytdan sorğu» formu dolduruldu/)).toBeVisible();
});

test("campaign: segment with live count, honest SMTP warning, sent once with results; the customer can unsubscribe", async ({ page, browser }) => {
  await signupCompany(page, "Kampaniya MMC");
  const origin = new URL(page.url()).origin;
  for (const [name, email] of [["Vüsal", "vusal@example.az"], ["Gülnar", "gulnar@example.az"]]) {
    await page.request.post("/api/v1/contacts", { data: { name, email, tags: ["xəbər"] }, headers: { origin } });
  }
  await page.locator("aside nav").getByRole("link", { name: "Marketinq" }).click();
  await page.getByRole("button", { name: "Yeni kampaniya" }).click();
  await page.getByLabel("Kampaniyanın adı").fill("Payız endirimi");
  await page.getByRole("textbox", { name: "Etiket" }).fill("xəbər");
  await expect(page.getByText("Alıcılar: 2")).toBeVisible();
  await expect(page.getByText(/SMTP\) qoşulmayıb/)).toBeVisible();
  await page.getByLabel("Mövzu").fill("{name}, endirim başladı");
  await page.getByLabel("Mətn").fill("Salam {name}! 20% endirim.");
  await page.getByRole("button", { name: "Qaralamanı saxla" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Göndər" }).click();
  await expect(page.getByText("Göndərilib", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Göndər" })).toHaveCount(0);

  // The unsubscribe page needs a click (link scanners only open it)
  const customer = await (await browser.newContext({ locale: "az-AZ" })).newPage();
  await customer.goto(`${origin}/u/bad.token.value`);
  await customer.getByRole("button", { name: "Abunəlikdən çıx" }).click();
  await expect(customer.getByText("Link yanlışdır.")).toBeVisible();
});

test("customer portal: link from the card, the customer answers a quote and opens a request; integrations list", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Kabinet MMC");
  const origin = new URL(page.url()).origin;
  const post = async (path: string, data: object) => (await page.request.post(`/api/v1${path}`, { data, headers: { origin } })).json();
  const c = await post("/contacts", { name: "Kamil Rzayev", email: "kamil@example.az" });
  const q = await post("/docs", { kind: "quote", contactId: c.id, currency: "AZN", lines: [{ name: "Mətbəx mebeli", quantity: 1, unit: "dəst", unitPrice: 250_000 }] });
  await post(`/docs/${q.id}/send`, { email: false });

  await page.goto(`/crm/${c.id}`);
  await recordTab(page, "Fayllar və kabinet");
  const card = page.getByRole("region", { name: "Müştəri kabineti" });
  await card.getByRole("button", { name: "Kabinet linki yarat" }).click();
  const link = await card.getByRole("textbox", { name: "Kabinet linki" }).inputValue();

  const customer = await (await browser.newContext({ locale: "az-AZ" })).newPage();
  await customer.goto(link);
  await expect(customer.getByRole("heading", { name: "Salam, Kamil Rzayev" })).toBeVisible();
  await customer.getByRole("link", { name: /Təklif/ }).click();
  await expect(customer.getByText("Mətbəx mebeli")).toBeVisible();
  await customer.getByLabel("Adınız").fill("Kamil Rzayev");
  await customer.getByRole("button", { name: "Qəbul edirəm" }).click();
  await expect(customer.getByText(/tarixində qəbul edib/)).toBeVisible();
  await customer.getByRole("link", { name: "Kabinetə qayıt" }).click();
  await customer.getByLabel("Mövzu").fill("Çatdırılma tarixi");
  await customer.getByRole("button", { name: "Göndər", exact: true }).click();
  await expect(customer.getByRole("region", { name: "Müraciətlər" }).getByText("Çatdırılma tarixi")).toBeVisible();

  await page.goto("/cases");
  await expect(page.getByText("Çatdırılma tarixi")).toBeVisible();

  await page.goto("/settings/integrations");
  await expect(page.getByText("Açıq API")).toBeVisible();
  await expect(page.getByText("Tezliklə").first()).toBeVisible();
});
