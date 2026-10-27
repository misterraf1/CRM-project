import { defineConfig } from "@playwright/test";

// UI tests against a running stack (npm run db:start + npm run dev, or the built apps).
// Locally they drive the installed Google Chrome; CI uses Playwright's own Chromium
// (`npx playwright install chromium`).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.CI ? undefined : "chrome",
    locale: "az-AZ",
    // Wide enough that all Kanban columns fit without scrolling: Playwright's dragTo
    // scrolls an off-screen target into view mid-drag, which cancels HTML5 drag.
    viewport: { width: 1920, height: 1080 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
