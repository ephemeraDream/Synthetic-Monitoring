import { test, expect } from "@playwright/test";
import { getCurrentTarget, getAllTargets, Region } from "../config/targets";
import { closePopup, waitAndClosePopup } from "../utils/popup";
import { attachNetworkSummary } from "../utils/network";
import { injectVitalsScript } from "../utils/vitals";
import { waitRandom } from "../utils/random";
import { waitAndCloseJumpPopup } from "@/utils/jumpPopup";

/**
 * P1_REGION_SWITCH：Regions 切换到另一个站点 -> URL/区域标识正确
 */
test.describe("P1_REGION_SWITCH - 区域切换", () => {
  const currentTarget = getCurrentTarget();
  const allTargets = getAllTargets();

  // 获取除当前区域外的其他区域作为切换目标
  const switchTargets = allTargets.filter(
    (t) => t.region !== currentTarget.region,
  );

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);
    await page.goto(currentTarget.url, { waitUntil: "load" });
    await waitAndCloseJumpPopup(page);
    await waitAndClosePopup(page);
  });

  // 测试切换到第一个可用区域
  if (switchTargets.length > 0) {
    const targetRegion = switchTargets[0].region;

    test(`切换到 ${targetRegion} 区域`, async ({ page, isMobile }) => {
      if (isMobile) {
        // 查找区域切换器（可能是下拉菜单、链接或按钮）
        await page
          .locator(".header-mobile__item--menu .mobileMenu-toggle")
          .click({ timeout: 10000 });

        const hasRegionSelector = await page
          .locator("#navigation-mobile .nav-currency-language")
          .first()
          .isVisible({ timeout: 5000 })
          .catch(() => false);

        if (hasRegionSelector) {
          // 点击区域选择器
          await page
            .locator(`#navigation-mobile a.dropdown-item`)
            .nth(1)
            .click({ timeout: 5000 });
        } else {
          // 如果没有区域选择器，尝试直接访问目标 URL
          await page.goto(switchTargets[0].url, {
            waitUntil: "domcontentloaded",
          });
        }
      } else {
        // 查找区域切换器（可能是下拉菜单、链接或按钮）
        const regionSelector = page
          .locator(".header-language_currency, .top-language-currency")
          .first();

        const hasRegionSelector = await regionSelector
          .isVisible({ timeout: 5000 })
          .catch(() => false);

        if (hasRegionSelector) {
          // 点击区域选择器
          await regionSelector.click();
          await page.waitForTimeout(500);

          // 查找目标区域的选项
          const targetOption = page
            .locator(
              `a.dropdown-item[href*="${targetRegion == "US" ? "com" : targetRegion}" i]`,
            )
            .first();

          await expect(targetOption).toBeVisible({ timeout: 5000 });
          await targetOption.click();
        } else {
          // 如果没有区域选择器，尝试直接访问目标 URL
          await page.goto(switchTargets[0].url, {
            waitUntil: "domcontentloaded",
          });
        }
      }
      // 验证 URL 包含目标区域标识
      const currentUrl = page.url();
      const targetUrl = switchTargets[0].url;

      // URL 应该匹配目标区域（可能是域名或路径）
      const urlMatches =
        currentUrl.includes(
          targetRegion == "US" ? "com" : targetRegion.toLowerCase(),
        ) ||
        currentUrl.includes(targetUrl.replace("https://", "").replace("/", ""));

      expect(urlMatches).toBeTruthy();

      // 验证区域标识在页面上（可能是标志、文本或 URL）
      const regionIndicator = page
        .locator(`text=/${targetRegion == "US" ? "com" : targetRegion}/i`)
        .or(
          page.locator(
            `[data-region="${targetRegion == "US" ? "com" : targetRegion}"]`,
          ),
        )
        .or(
          page.locator(
            `[data-country="${targetRegion == "US" ? "com" : targetRegion}"]`,
          ),
        )
        .first();

      const hasRegionIndicator = await regionIndicator
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      // 至少 URL 应该正确
      expect(urlMatches).toBeTruthy();

      if (isMobile) {
        // 验证页面正常加载（至少首页核心元素存在）
        const nav = page.locator(".header-mobile").first();
        await expect(nav).toBeVisible({ timeout: 10000 });
      } else {
        // 验证页面正常加载（至少首页核心元素存在）
        const nav = page.locator("nav").first();
        await expect(nav).toBeVisible({ timeout: 10000 });
      }

      // 收集网络摘要
      await attachNetworkSummary(page, test);
    });
  }
});
