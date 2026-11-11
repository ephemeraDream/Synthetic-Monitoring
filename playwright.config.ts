import { defineConfig, devices } from "@playwright/test";

const DEFAULT_CI_WORKERS = 2;
const DEFAULT_CI_RETRIES = 1;
const DEFAULT_TEST_TIMEOUT_MS = 120_000;

function positiveNumberOrFallback(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeIntegerOrFallback(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

const ciWorkers = positiveNumberOrFallback(
  process.env.PLAYWRIGHT_WORKERS,
  DEFAULT_CI_WORKERS,
);
const ciRetries = nonNegativeIntegerOrFallback(
  process.env.PLAYWRIGHT_RETRIES,
  DEFAULT_CI_RETRIES,
);
const testTimeout = positiveNumberOrFallback(
  process.env.PLAYWRIGHT_TEST_TIMEOUT,
  DEFAULT_TEST_TIMEOUT_MS,
);

export default defineConfig({
  testDir: "./src/journeys",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? ciRetries : 0,
  workers:
    process.env.CI
      ? Number.isFinite(ciWorkers) && ciWorkers > 0
        ? ciWorkers
        : DEFAULT_CI_WORKERS
      : undefined,
  timeout: testTimeout,
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
