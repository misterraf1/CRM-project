import { expect, test, type Page } from "@playwright/test";
import { signupCompany } from "./helpers";

/** Data setup through the same-origin proxy (the browser session's cookies, our Origin). */
async function post(page: Page, path: string, data: unknown) {
  const origin = new URL(page.url()).origin;
  const res = await page.request.post(`/api/v1${path}`, { data, headers: { origin } });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return res.json();
}

test("analytics: real figures, period switch, member table and CSV export", async ({ page }) => {
  await signupCompany(page, "Analitika UI MMC");
  const contact = await post(page, "/contacts", { name: "Leyla Həsənova", source: "instagram" });
  const deal = await post(page, "/deals", { title: "Korporativ sayt", amount: 750_000, contactId: contact.id });
  const pipelines = await (await page.request.get("/api/v1/pipelines")).json();
  const won = pipelines[0].stages.find((s: { kind: string }) => s.kind === "won");
  const origin = new URL(page.url()).origin;
  expect((await page.request.post(`/api/v1/deals/${deal.id}/move`, { data: { stageId: won.id }, headers: { origin } })).ok()).toBeTruthy();

  await page.locator("aside nav").getByRole("link", { name: "Analitika" }).click();
  await expect(page.getByRole("heading", { name: "Analitika", exact: true })).toBeVisible();
  await expect(page.getByText("Qazanma faizi", { exact: true }).first().locator("..")).toContainText("100%");
  await expect(page.getByRole("cell", { name: "Instagram" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Elvin Rzayev/ })).toBeVisible();

  await page.getByRole("link", { name: "30 gün" }).click();
  await expect(page).toHaveURL(/period=30d/);
  await expect(page.getByRole("link", { name: "30 gün" })).toHaveAttribute("aria-current", "page");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Sövdələşmələri CSV kimi yüklə" }).click()]);
  expect(download.suggestedFilename()).toBe("deals.csv");
  const path = await download.path();
  const text = (await import("node:fs")).readFileSync(path!, "utf8");
  expect(text).toContain('"Korporativ sayt","7500.00"');
});
