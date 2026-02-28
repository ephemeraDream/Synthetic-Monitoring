import { test, expect } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { closePopup, waitAndClosePopup } from "../utils/popup";
import { attachNetworkSummary } from "../utils/network";
import { injectVitalsScript } from "../utils/vitals";
import { waitRandom } from "../utils/random";

/**
 * P1_SEARCH：搜索 Athena/Atlas -> 结果出现 -> 进入 PDP
 */
test.describe("P1_SEARCH - 搜索功能", () => {
  const target = getCurrentTarget();

  // 测试的搜索关键词
  const searchTerms = ["Athena Pro", "Atlas"];

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);

    await page.goto(target.url, { waitUntil: "load" });
    await waitAndClosePopup(page);
  });

  for (const searchTerm of searchTerms) {
    test(`搜索商品: ${searchTerm}`, async ({ page, isMobile }) => {
      if (isMobile) {
        const searchIcon = page
          .locator(".header-mobile__item--search .header__search .header__icon")
          .first();

        const searchForm = page.locator("#search-form-mobile");

        await searchIcon.click();

        try {
          await expect(searchForm).toBeVisible({ timeout: 3000 });
        } catch {
          // 如果没弹出，再点一次
          await searchIcon.click();
          await expect(searchForm).toBeVisible();
        }

        // 查找搜索框
        const searchInput = page.locator("#Search-In-Modal-Sidebar").first();

        await expect(searchInput).toBeVisible({ timeout: 10000 });

        // 输入搜索关键词
        await searchInput.fill(searchTerm);
        await page.waitForTimeout(500);

        // 提交搜索（按 Enter 或点击搜索按钮）
        await searchInput.press("Enter");

        // 或者点击搜索按钮
        const searchButton = page
          .getByRole("button", { name: /search|搜索/i })
          .or(page.locator('button[type="submit"]'))
          .first();
        const hasSearchButton = await searchButton
          .isVisible({ timeout: 2000 })
          .catch(() => false);
        if (hasSearchButton) {
          await searchButton.click();
        }
      } else {
        const searchIcon = page.locator(".header__search").first();
        await searchIcon.click({ timeout: 10000 });

        // 查找搜索框
        const searchInput = page
          .getByRole("searchbox")
          .or(page.getByPlaceholder(/search|搜索/i))
          .or(page.locator('input[type="search"]'))
          .or(page.locator('[data-testid*="search"]'))
          .first();

        await expect(searchInput).toBeVisible({ timeout: 10000 });

        // 输入搜索关键词
        await searchInput.fill(searchTerm);
        await page.waitForTimeout(500);

        // 提交搜索（按 Enter 或点击搜索按钮）
        await searchInput.press("Enter");

        // 或者点击搜索按钮
        const searchButton = page
          .getByRole("button", { name: /search|搜索/i })
          .or(page.locator('button[type="submit"]'))
          .first();
        const hasSearchButton = await searchButton
          .isVisible({ timeout: 2000 })
          .catch(() => false);
        if (hasSearchButton) {
          await searchButton.click();
        }
      }

      // 等待搜索结果页加载
      await page
        .waitForURL(/\/search|\/results?/i, { timeout: 10000 })
        .catch(() => {});

      // 验证搜索结果出现
      const resultsContainer = page
        .locator('.search-results, .results, [data-testid="search-results"]')
        .first();
      const hasResultsContainer = await resultsContainer
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      // 验证至少有一个结果项
      const resultItem = page
        .locator(
          '.product-card, .search-result-item, [data-testid*="product"], .product_categories_product',
        )
        .first();
      await expect(resultItem).toBeVisible({ timeout: 10000 });

      // 验证搜索关键词在结果中（标题或描述）
      const resultWithKeyword = page
        .locator(
          ".product-title, .result-title, h2, h3, .product_categories_product_title",
        )
        .filter({ hasText: new RegExp(searchTerm, "i") })
        .first();
      await expect(resultWithKeyword).toBeVisible({ timeout: 10000 });

      // 点击第一个搜索结果进入 PDP
      await resultItem.click();

      // 等待进入商品详情页
      await page
        .waitForURL(/\/products?|\/p\//i, { timeout: 10000 })
        .catch(() => {});

      // 验证商品详情页
      const productTitle = page
        .locator(".product_info_new_product_title")
        .first();
      await expect(productTitle).toBeVisible({ timeout: 10000 });

      // 验证标题包含搜索关键词（可选，因为可能有变体）
      const titleText = await productTitle.textContent();
      expect(titleText?.toLowerCase()).toContain(searchTerm.toLowerCase());

      // 收集网络摘要
      await attachNetworkSummary(page, test);
    });
  }
});
