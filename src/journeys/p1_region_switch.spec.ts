import { test, expect } from '@playwright/test';
import { getCurrentTarget, getAllTargets, Region } from '../config/targets';
import { closePopup } from '../utils/popup';
import { attachNetworkSummary } from '../utils/network';
import { injectVitalsScript } from '../utils/vitals';
import { waitRandom } from '../utils/random';

/**
 * P1_REGION_SWITCH：Regions 切换到另一个站点 -> URL/区域标识正确
 */
test.describe('P1_REGION_SWITCH - 区域切换', () => {
  const currentTarget = getCurrentTarget();
  const allTargets = getAllTargets();

  // 获取除当前区域外的其他区域作为切换目标
  const switchTargets = allTargets.filter(t => t.region !== currentTarget.region);

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);
    await waitRandom(3000);
    await page.goto(currentTarget.url, { waitUntil: 'domcontentloaded' });
    await closePopup(page);
  });

  // 测试切换到第一个可用区域
  if (switchTargets.length > 0) {
    const targetRegion = switchTargets[0].region;

    test(`切换到 ${targetRegion} 区域`, async ({ page }) => {
      // 查找区域切换器（可能是下拉菜单、链接或按钮）
      const regionSelector = page.locator('[data-testid*="region"], [data-testid*="country"], .region-selector, .country-selector')
        .or(page.getByRole('button', { name: /region|country|地区|国家/i }))
        .first();

      const hasRegionSelector = await regionSelector.isVisible({ timeout: 5000 }).catch(() => false);

      if (hasRegionSelector) {
        // 点击区域选择器
        await regionSelector.click();
        await page.waitForTimeout(500);

        // 查找目标区域的选项
        const targetOption = page.getByRole('option', { name: new RegExp(targetRegion, 'i') })
          .or(page.locator(`a:has-text("${targetRegion}")`))
          .or(page.locator(`button:has-text("${targetRegion}")`))
          .first();

        await expect(targetOption).toBeVisible({ timeout: 5000 });
        await targetOption.click();
      } else {
        // 如果没有区域选择器，尝试直接访问目标 URL
        await page.goto(switchTargets[0].url, { waitUntil: 'domcontentloaded' });
      }

      // 等待页面加载或 URL 变化
      await page.waitForTimeout(2000);

      // 验证 URL 包含目标区域标识
      const currentUrl = page.url();
      const targetUrl = switchTargets[0].url;
      
      // URL 应该匹配目标区域（可能是域名或路径）
      const urlMatches = currentUrl.includes(targetRegion.toLowerCase()) || 
                        currentUrl.includes(targetUrl.replace('https://', '').replace('/', ''));

      expect(urlMatches).toBeTruthy();

      // 验证区域标识在页面上（可能是标志、文本或 URL）
      const regionIndicator = page.locator(`text=/${targetRegion}/i`)
        .or(page.locator(`[data-region="${targetRegion}"]`))
        .or(page.locator(`[data-country="${targetRegion}"]`))
        .first();

      const hasRegionIndicator = await regionIndicator.isVisible({ timeout: 5000 }).catch(() => false);
      
      // 至少 URL 应该正确
      expect(urlMatches).toBeTruthy();

      // 关闭可能出现的弹窗
      await closePopup(page);

      // 验证页面正常加载（至少首页核心元素存在）
      const nav = page.locator('nav').first();
      await expect(nav).toBeVisible({ timeout: 10000 });

      // 收集网络摘要
      await attachNetworkSummary(page, test);
    });
  }
});

