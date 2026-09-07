import { defineConfig, devices } from "@playwright/test";

// Two browser-test layers:
//  - sld-mockup: the AI Factory single-line HTML mockup, driven via file://
//    (no web server), exercising real pointer interactions on connectors.
//  - app: smoke of the running Next.js app (npm run dev) — the three tool
//    pages mount without client errors, gated tools show tool or sign-in card.
export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
  },
  projects: [
    {
      name: "sld-mockup",
      testDir: "./drafts/sld/e2e",
    },
    {
      name: "app",
      testDir: "./e2e",
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
        baseURL: "http://localhost:3000",
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
