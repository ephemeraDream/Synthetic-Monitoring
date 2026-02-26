import { test, expect } from '@playwright/test';
import { getCurrentTarget } from '../config/targets';
import { closePopup } from '../utils/popup';
import { attachNetworkSummary } from '../utils/network';
import { injectVitalsScript } from '../utils/vitals';
import { waitRandom } from '../utils/random';

/**
 * P0_PDP_ADD_TO_CART：商品详情页 -> Add to Cart -> cart 状态变化
 */
test.describe('P0_PDP_ADD_TO_CART - 商品加购', () => {
  const target = getCurrentTarget();

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);
    await waitRandom(3000);
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });
    await closePopup(page);
  });

  test('进入商品详情页并添加到购物车', async ({ page }) => {
    // 方法1：从首页点击第一个商品
    const firstProduct = page.locator('.product-card, .product-item, [data-testid*="product"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    // 等待进入商品详情页
    await page.waitForURL(/\/products?|\/p\//i, { timeout: 10000 }).catch(() => {});

    // 关闭可能出现的弹窗
    await closePopup(page);

    // 验证商品详情页核心元素
    const productTitle = page.locator('h1, .product-title, [data-testid="product-title"]').first();
    await expect(productTitle).toBeVisible({ timeout: 10000 });

    // 验证价格存在（但不依赖具体价格值）
    const price = page.locator('.price, [data-testid*="price"], .product-price').first();
    await expect(price).toBeVisible({ timeout: 5000 });

    // 查找并点击 "Add to Cart" 按钮
    const addToCartButton = page.getByRole('button', { name: /add to cart|加入购物车/i })
      .or(page.locator('button:has-text("Add to Cart")'))
      .or(page.locator('[data-testid*="add-to-cart"]'))
      .first();

    await expect(addToCartButton).toBeVisible({ timeout: 10000 });
    await expect(addToCartButton).toBeEnabled({ timeout: 5000 });

    // 记录加购前的购物车状态（如果有显示）
    const cartCountBefore = await page.locator('[data-testid*="cart-count"], .cart-count, .cart-badge')
      .first()
      .textContent()
      .catch(() => null);

    // 点击加购按钮
    await addToCartButton.click();

    // 等待加购成功反馈（可能是 toast、弹窗、或购物车数量变化）
    await page.waitForTimeout(2000);

    // 验证加购成功（至少满足以下之一）：
    // 1. 购物车数量增加
    // 2. 出现成功提示
    // 3. 按钮状态变化

    const cartCountAfter = await page.locator('[data-testid*="cart-count"], .cart-count, .cart-badge')
      .first()
      .textContent()
      .catch(() => null);

    const successMessage = page.locator('text=/added to cart|已加入购物车|success/i').first();
    const hasSuccessMessage = await successMessage.isVisible({ timeout: 3000 }).catch(() => false);

    // 至少有一个成功指标
    const cartChanged = cartCountBefore !== cartCountAfter && cartCountAfter !== null;
    expect(cartChanged || hasSuccessMessage).toBeTruthy();

    // 收集网络摘要
    await attachNetworkSummary(page, test);
  });
});

