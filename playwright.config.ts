import { defineConfig, devices } from '@playwright/test';

/**
 * Blacklyte 全球合成监控配置
 * 支持 Desktop、iPhone、Android 多设备覆盖
 */
export default defineConfig({
  testDir: './src/journeys',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60000, // 测试超时时间：60 秒
  expect: {
    timeout: 10000, // 断言超时时间：10 秒
  },
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://blacklyte.com',
    trace: 'retain-on-failure', // 失败时保留 trace（可在 Playwright Inspector 中查看）
    screenshot: 'only-on-failure', // 失败时自动截图
    video: 'retain-on-failure', // 失败时保留录屏
    actionTimeout: 10000,
    navigationTimeout: 30000,
    // 启用 HAR 收集（需要时）
    // har: 'on',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-iphone',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'mobile-android',
      use: { ...devices['Pixel 7'] },
    },
  ],
});

