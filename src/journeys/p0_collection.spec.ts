import { test, expect } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { closePopup } from "../utils/popup";
import { attachNetworkSummary } from "../utils/network";
import { injectVitalsScript } from "../utils/vitals";
import { waitRandom } from "../utils/random";

/**
 * P0_COLLECTION：进入分类页（Chairs/Desks/Accessories）-> 列表加载
 */
test.describe("P0_COLLECTION - 分类页列表", () => {
  const target = getCurrentTarget();

  // 测试的分类列表
  const collections = ["Chairs", "Desks", "Accessories"];

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);
    await waitRandom(3000);
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await closePopup(page);
  });

  for (const collection of collections) {
    test(`分类页加载: ${collection}`, async ({ page, isMobile }) => {
      if (isMobile) {
        await page
          .locator(".header-mobile__item--menu .mobileMenu-toggle")
          .click({ timeout: 10000 });

        // 查找分类链接（优先使用文本匹配）
        const collectionLinkMb = page
          .locator(`#navigation-mobile a.menu_text:has-text("${collection}")`)
          .first();

        // 点击分类
        await expect(collectionLinkMb).toBeVisible({ timeout: 10000 });
        await collectionLinkMb.click();

        // 点击分类
        await expect(
          page
            .locator(
              `#navigation-mobile .all-chairs-line[data-url*="${collection}" i]`,
            )
            .first(),
        ).toBeVisible({ timeout: 10000 });
        await page
          .locator(
            `#navigation-mobile .all-chairs-line[data-url*="${collection}" i]`,
          )
          .first()
          .click();
      } else {
        await page
          .locator(
            '.menu-lv-item .header__menu-item .text:has-text("Products")',
          )
          .hover({ timeout: 10000 });

        // 查找分类链接（优先使用文本匹配）
        const collectionLink = page
          .locator(`a.nav-menu-items:has-text("${collection}")`)
          .first();

        // 点击分类
        await expect(collectionLink).toBeVisible({ timeout: 10000 });
        await collectionLink.click();
      }

      // 等待 URL 变化（分类页通常有路径变化）
      await page
        .waitForURL(/\/collections?|\/category|\/shop/i, { timeout: 10000 })
        .catch(() => {});

      // 验证分类页标题或面包屑
      const pageTitle = page
        .locator(".collection_head_new_select_title")
        .filter({ hasText: new RegExp(collection, "i") })
        .first();
      await expect(pageTitle).toBeVisible({ timeout: 10000 });

      // 验证产品列表容器存在
      const productGrid = page
        .locator(".collection-banner-adv .collection .productGrid")
        .first();
      await expect(productGrid).toBeVisible({ timeout: 10000 });

      // 验证至少有一个产品卡片
      const productCard = page
        .locator('.variable-products, .product-item, [data-testid*="product"]')
        .first();
      await expect(productCard).toBeVisible({ timeout: 10000 });

      // 收集网络摘要
      await attachNetworkSummary(page, test);
    });
  }
});
