import { test, expect } from '@playwright/test';
import { getCurrentTarget } from '../config/targets';
import { closePopup } from '../utils/popup';
import { attachNetworkSummary } from '../utils/network';
import { injectVitalsScript } from '../utils/vitals';
import { waitRandom } from '../utils/random';

/**
 * P1_SEARCH：搜索 Athena/Atlas -> 结果出现 -> 进入 PDP
 */
test.describe('P1_SEARCH - 搜索功能', () => {
  const target = getCurrentTarget();

  // 测试的搜索关键词
  const searchTerms = ['Athena', 'Atlas'];

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);
    await waitRandom(3000);
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });
    await closePopup(page);
  });

  for (const searchTerm of searchTerms) {
    test(`搜索商品: ${searchTerm}`, async ({ page }) => {
      // 查找搜索框
      const searchInput = page.getByRole('searchbox')
        .or(page.getByPlaceholder(/search|搜索/i))
        .or(page.locator('input[type="search"]'))
        .or(page.locator('[data-testid*="search"]'))
        .first();

      await expect(searchInput).toBeVisible({ timeout: 10000 });

      // 输入搜索关键词
      await searchInput.fill(searchTerm);
      await page.waitForTimeout(500);

      // 提交搜索（按 Enter 或点击搜索按钮）
      await searchInput.press('Enter');

      // 或者点击搜索按钮
      const searchButton = page.getByRole('button', { name: /search|搜索/i })
        .or(page.locator('button[type="submit"]'))
        .first();
      const hasSearchButton = await searchButton.isVisible({ timeout: 2000 }).catch(() => false);
      if (hasSearchButton) {
        await searchButton.click();
      }

      // 等待搜索结果页加载
      await page.waitForURL(/\/search|\/results?/i, { timeout: 10000 }).catch(() => {});

      // 验证搜索结果出现
      const resultsContainer = page.locator('.search-results, .results, [data-testid="search-results"]').first();
      const hasResultsContainer = await resultsContainer.isVisible({ timeout: 5000 }).catch(() => false);

      // 验证至少有一个结果项
      const resultItem = page.locator('.product-card, .search-result-item, [data-testid*="product"]').first();
      await expect(resultItem).toBeVisible({ timeout: 10000 });

      // 验证搜索关键词在结果中（标题或描述）
      const resultWithKeyword = page.locator('.product-title, .result-title, h2, h3')
        .filter({ hasText: new RegExp(searchTerm, 'i') })
        .first();
      await expect(resultWithKeyword).toBeVisible({ timeout: 10000 });

      // 点击第一个搜索结果进入 PDP
      await resultItem.click();

      // 等待进入商品详情页
      await page.waitForURL(/\/products?|\/p\//i, { timeout: 10000 }).catch(() => {});
      await closePopup(page);

      // 验证商品详情页
      const productTitle = page.locator('h1, .product-title, [data-testid="product-title"]').first();
      await expect(productTitle).toBeVisible({ timeout: 10000 });

      // 验证标题包含搜索关键词（可选，因为可能有变体）
      const titleText = await productTitle.textContent();
      expect(titleText?.toLowerCase()).toContain(searchTerm.toLowerCase());

      // 收集网络摘要
      await attachNetworkSummary(page, test);
    });
  }
});

