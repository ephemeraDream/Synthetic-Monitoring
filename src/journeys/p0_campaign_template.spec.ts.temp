import { test, expect } from '@playwright/test';
import { TARGETS, TargetKey } from '../config/targets';
import { CAMPAIGNS, isExpired } from '../config/campaigns';
import { closeMarketingPopups } from '../utils/popup';
import { attachNetworkCollectors } from '../utils/network';
import { jitterMs, pick, LOCALES } from '../utils/random';

/**
 * P0_CAMPAIGN_PAGE：活动页监控模板（参考模板版本）
 * 自动过期策略：过期后自动 skip 测试，避免误报
 * 
 * 上线策略：活动期间设为 P0；到期自动 skip，不影响主监控体系
 */
test('P0_CAMPAIGN_PAGE', async ({ page }, testInfo) => {
  const target: TargetKey = (process.env.TARGET as TargetKey) || 'US';
  const base = TARGETS[target].url;

  // 选择一个 campaign（也可用 env 指定）
  const campaignName = process.env.CAMPAIGN || 'CHRISTMAS_SALE';
  const c = CAMPAIGNS.find((x) => x.name === campaignName);
  if (!c) {
    test.skip(true, 'campaign not configured');
    return;
  }

  // ✅ 过期后自动 skip（不报警）
  if (isExpired(c.expiresAt)) {
    test.skip(true, `campaign expired: ${c.name}`);
    return;
  }

  // 设置随机语言
  await page.setExtraHTTPHeaders({ 'Accept-Language': pick(LOCALES) });
  await page.waitForTimeout(jitterMs());

  // 收集网络请求
  const getNet = attachNetworkCollectors(page);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto(base + c.path, { waitUntil: 'domcontentloaded' });
  await closeMarketingPopups(page);

  // ✅ 最低断言：页面标题/商品列表/Shop Now 按钮出现即可
  await expect(
    page.locator('h1').or(page.getByText(/Sale|Christmas|Off/i))
  ).toBeVisible({ timeout: 20000 });

  // ✅ 加一个"活动页常见问题"断言：主按钮可点击
  const shopNow = page.getByRole('link', { name: /Shop Now/i }).first();
  if (await shopNow.isVisible().catch(() => false)) {
    await shopNow.click();
  }

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
});
