import { defineConfig, devices } from "@playwright/test";

// Browser smoke layer for the AI Factory single-line mockup. Drives the static
// HTML via file:// (no web server) and exercises the real pointer interactions
// for editing connectors (create / re-route / delete).
export default defineConfig({
  testDir: "./drafts/sld/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
  },
});
