import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { signupCompany } from "./helpers";

// Automated WCAG 2.2 A/AA check (axe-core) on the main pages, light and dark.
// Manual checks (screen reader flow, focus order) still matter; this keeps regressions out.
const AXE = readFileSync(createRequire(__filename).resolve("axe-core/axe.min.js"), "utf8");

async function violations(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`WCAG AA: no automated violations (${scheme})`, async ({ browser }) => {
    const page = await (await browser.newContext({ colorScheme: scheme, locale: "az-AZ", viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto("/login");
    expect(await violations(page), "/login").toEqual([]);
    await signupCompany(page, `A11y ${scheme}`);
    for (const path of ["/dashboard", "/inbox", "/crm", "/deals", "/tasks", "/chat", "/files", "/analytics", "/settings/billing"]) {
      await page.goto(path);
      expect(await violations(page), path).toEqual([]);
    }
  });
}

test("skip link jumps to the main content", async ({ page }) => {
  await signupCompany(page, "Skip MMC");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Əsas məzmuna keç" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});
