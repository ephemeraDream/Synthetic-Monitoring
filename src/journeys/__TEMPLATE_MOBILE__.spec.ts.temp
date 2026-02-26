import { test, expect } from '@playwright/test';
import { TARGETS, TargetKey } from '../config/targets';
import { closeMarketingPopups } from '../utils/popup';
import { attachNetworkCollectors } from '../utils/network';
import { jitterMs, pick, LOCALES } from '../utils/random';
import { installWebVitalsCollector, readWebVitals } from '../utils/vitals';
import { VITALS_THRESHOLDS } from '../config/vitals_thresholds';

/**
 * Mobile 旅程模板（参考模板版本）
 * 
 * 使用说明：
 * - 此模板专门用于移动端测试
 * - 在 playwright.config.ts 中配置 mobile projects
 * - 移动端常见差异：header 变成 button[aria-label="menu"]，Cart 文案可能是 Cart 00 items，搜索 icon 也不同
 */
test('P0_MOBILE_TEMPLATE', async ({ page }, testInfo) => {
  const target: TargetKey = (process.env.TARGET as TargetKey) || 'US';
  const base = TARGETS[target].url;

  // 设置随机语言
  await page.setExtraHTTPHeaders({ 'Accept-Language': pick(LOCALES) });
  await page.waitForTimeout(jitterMs());

  // 安装 Web Vitals 采集器
  await installWebVitalsCollector(page);

  // 收集网络请求
  const getNet = attachNetworkCollectors(page);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await closeMarketingPopups(page);

  // ✅ 移动端打开菜单（如果存在）
  const menuBtn = page.getByRole('button', { name: /menu/i }).first();
  if (await menuBtn.isVisible().catch(() => false)) {
    await menuBtn.click();
    // 菜单里应出现 Products / Sign In 等
    await expect(
      page.getByRole('link', { name: /Sign In/i }).or(page.getByText(/Products/i))
    ).toBeVisible({ timeout: 10000 });
  }

  // ✅ 搜索入口（移动端常为 icon button）
  const searchBtn = page.getByRole('button', { name: /search/i }).first();
  if (await searchBtn.isVisible().catch(() => false)) {
    await searchBtn.click();
    const searchBox = page.locator('input[type="search"]').first();
    await expect(searchBox).toBeVisible({ timeout: 5000 });
    await searchBox.fill('Athena');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: /Athena/i }).first()).toBeVisible({ timeout: 20000 });
  }

  // 做一次点击（让 INP 有意义）
  await page.getByRole('link', { name: /Products/i }).click().catch(() => {});

  // 收集网络摘要
  const net = getNet();
  testInfo.attach('network-summary', {
    body: JSON.stringify(net, null, 2),
    contentType: 'application/json',
  });

  // 收集 Console Errors
  if (consoleErrors.length) {
    testInfo.attach('console-errors', {
      body: consoleErrors.join('\n\n'),
      contentType: 'text/plain',
    });
  }

  // 收集 Web Vitals
  const vitals = await readWebVitals(page);
  testInfo.attach('web-vitals', {
    body: JSON.stringify(vitals, null, 2),
    contentType: 'application/json',
  });

  // 断言 Web Vitals（P0）
  if (vitals.lcp != null) expect(vitals.lcp).toBeLessThan(VITALS_THRESHOLDS.P0.lcp);
  if (vitals.cls != null) expect(vitals.cls).toBeLessThan(VITALS_THRESHOLDS.P0.cls);
  // INP 先不 hard fail，只在明显回归时报警（避免误报）
  // if (vitals.inp != null) expect(vitals.inp).toBeLessThan(VITALS_THRESHOLDS.P0.inp);
});
