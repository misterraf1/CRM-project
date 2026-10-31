import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

test("dashboard: quick actions, today at a glance, tabbed queue, and each member hides what they don't use", async ({ page }) => {
  await signupCompany(page, "Panel Test MMC");
  const origin = new URL(page.url()).origin;
  await page.request.post("/api/v1/tasks", { data: { title: "Dünən bitməli idi", dueAt: new Date(Date.now() - 30 * 3_600_000) }, headers: { origin } });
  await page.reload();

  // Today: counts that open where the work is
  const today = page.getByRole("region", { name: "Bu gün" });
  await expect(today.getByRole("link", { name: /1\s*gecikən tapşırıq/ })).toBeVisible();
  // No won deals yet: a hint, not an empty grid
  await expect(page.getByText(/hələ bağlanmış satış yoxdur/)).toBeVisible();

  // The queue opens on the busiest tab
  await expect(page.getByRole("tab", { name: /Tapşırıqlar/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").getByText("Dünən bitməli idi")).toBeVisible();
  await page.getByRole("tab", { name: /Mesajlar/ }).click();
  await expect(page.getByRole("tab", { name: /Mesajlar/ })).toHaveAttribute("aria-selected", "true");

  // Customise: hide the team table, it stays hidden after a reload, then everything comes back
  await expect(page.getByRole("heading", { name: "İşçi performansı" })).toBeVisible();
  await page.getByRole("button", { name: "Paneli fərdiləşdir" }).click();
  const dialog = page.getByRole("dialog", { name: "Paneldə nələr görünsün?" });
  await dialog.getByRole("switch", { name: "İşçi performansı" }).uncheck();
  await dialog.getByRole("button", { name: "Hazırdır" }).click();
  await expect(page.getByRole("heading", { name: "İşçi performansı" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "İşçi performansı" })).toHaveCount(0);
  await page.getByRole("button", { name: "Paneli fərdiləşdir" }).click();
  await page.getByRole("dialog", { name: "Paneldə nələr görünsün?" }).getByRole("button", { name: "Hamısını göstər" }).click();
  await page.getByRole("dialog", { name: "Paneldə nələr görünsün?" }).getByRole("button", { name: "Hazırdır" }).click();
  await expect(page.getByRole("heading", { name: "İşçi performansı" })).toBeVisible();

  // Quick action: a new deal opens the board's form
  await page.getByRole("navigation", { name: "Sürətli əməliyyatlar" }).getByRole("link", { name: /Satış/ }).click();
  await expect(page).toHaveURL(/\/deals\?new=1/);
  await expect(page.getByLabel("Satışın adı")).toBeVisible();
});
