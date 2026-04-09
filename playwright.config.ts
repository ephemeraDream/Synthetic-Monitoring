import { defineConfig, devices } from "@playwright/test";

const DEFAULT_CI_WORKERS = 2;
const ciWorkers = Number(process.env.PLAYWRIGHT_WORKERS ?? DEFAULT_CI_WORKERS);

export default defineConfig({
  testDir: "./src/journeys",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers:
    process.env.CI
      ? Number.isFinite(ciWorkers) && ciWorkers > 0
        ? ciWorkers
        : DEFAULT_CI_WORKERS
      : undefined,
  timeout: 600000,
  expect: {
    timeout: 10000,
  },
  reporter: [
    ["html"],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: process.env.BASE_URL || "https://blacklyte.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-iphone",
      use: { ...devices["iPhone 14"] },
    },
    {
      name: "mobile-android",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
