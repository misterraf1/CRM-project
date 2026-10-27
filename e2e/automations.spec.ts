import { expect, test, type Page } from "@playwright/test";
import { signupCompany } from "./helpers";

async function post(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: { origin: new URL(page.url()).origin } });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return res.json();
}

test("automation from a template: won deal → follow-up task and notification; toggle and delete", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signupCompany(page, "Avtomat MMC");
  await page.locator("aside nav").getByRole("link", { name: "Avtomatlaşdırma" }).click();
  await expect(page.getByText("Hələ qayda yoxdur")).toBeVisible();

  await page.getByRole("button", { name: "Qazanılan sövdələşmədən sonra təşəkkür zəngi" }).click();
  const form = page.getByRole("form", { name: "Yeni qayda" });
  await expect(form.getByRole("combobox", { name: /^Nə vaxt/ })).toHaveValue("deal.stage_changed");
  await expect(form.getByRole("combobox", { name: /^Mərhələ/ })).not.toHaveValue("");
  await form.getByRole("button", { name: "Yadda saxla" }).click();
  const rule = page.getByRole("listitem").filter({ hasText: "Qazanılan sövdələşmədən sonra təşəkkür zəngi" });
  await expect(rule).toContainText("Sövdələşmə mərhələsi dəyişəndə");
  await expect(rule).toContainText("0 dəfə işləyib");

  // The event happens; the rule runs within seconds
  const deal = await post(page, "/deals", { title: "Böyük müqavilə", amount: 1_200_000 });
  const pipelines = await (await page.request.get("/api/v1/pipelines")).json();
  const won = pipelines[0].stages.find((s: { kind: string }) => s.kind === "won");
  await post(page, `/deals/${deal.id}/move`, { stageId: won.id });

  await expect(async () => {
    await page.goto("/tasks");
    await expect(page.getByText("Təşəkkür zəngi: Böyük müqavilə")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /Bildirişlər/ }).click();
  await expect(page.getByText("Qazanıldı: Böyük müqavilə")).toBeVisible();

  await page.goto("/automations");
  await expect(rule).toContainText("1 dəfə işləyib");
  await rule.getByRole("button", { name: "Son icralar" }).click();
  await expect(rule.getByText("Uğurlu")).toBeVisible();
  await rule.getByRole("checkbox", { name: /Aktivdir/ }).uncheck();
  await expect(rule.getByRole("checkbox", { name: /Aktivdir/ })).not.toBeChecked();
  await rule.getByRole("button", { name: /^Sil:/ }).click();
  await expect(page.getByText("Hələ qayda yoxdur")).toBeVisible();
});
