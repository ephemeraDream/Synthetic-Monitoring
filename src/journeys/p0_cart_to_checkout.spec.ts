import { test, expect } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { closePopup } from "../utils/popup";
import { attachNetworkSummary } from "../utils/network";
import { injectVitalsScript } from "../utils/vitals";
import { waitRandom } from "../utils/random";

/**
 * P0_CART_TO_CHECKOUT：cart -> checkout 前一步（不需要支付）
 */
test.describe("P0_CART_TO_CHECKOUT - 购物车到结算", () => {
  const target = getCurrentTarget();

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);
    await waitRandom(3000);
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await closePopup(page);
  });

  test("购物车到结算流程", async ({ page }) => {
    // 步骤1：添加商品到购物车
    const firstProduct = page
      .locator('.link-cont, .product-item, [data-testid*="product"]')
      .first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    await page
      .waitForURL(/\/products?|\/p\//i, { timeout: 10000 })
      .catch(() => {});
    await page.waitForLoadState("domcontentloaded");
    await closePopup(page);

    const addToCartButton = page
      .getByRole("button", { name: /add to cart|加入购物车/i })
      .or(page.locator('button:has-text("Add to Cart")'))
      .first();

    await expect(addToCartButton).toBeVisible({ timeout: 10000 });
    await addToCartButton.click();
    await page.waitForTimeout(2000);

    // 步骤2：打开购物车
    await expect(page.locator("#halo-side-cart-preview")).toBeVisible({
      timeout: 5000,
    });
    const viewCartButton = page
      .locator('a.button-view-cart:has-text("View Cart")')
      .or(page.locator('a.button-view-cart[href^="/cart"]'))
      .first();
    await viewCartButton.click({ timeout: 5000 });

    // 等待购物车页面加载
    await page.waitForURL(/\/cart/i, { timeout: 10000 }).catch(() => {});
    await closePopup(page);

    // 验证购物车页面元素
    const cartTitle = page
      .locator('h1, .cart-title, [data-testid="cart-title"]')
      .filter({ hasText: /cart|购物车/i })
      .first();
    await expect(cartTitle).toBeVisible({ timeout: 10000 });

    // 验证购物车中有商品
    const cartItem = page
      .locator('.cart-item, [data-testid*="cart-item"], .line-item')
      .first();
    await expect(cartItem).toBeVisible({ timeout: 10000 });

    // 步骤3：点击结算按钮（Checkout）
    const checkoutButton = page
      .getByRole("button", { name: /checkout|结算|proceed to checkout/i })
      .or(page.locator('a:has-text("Checkout")'))
      .or(page.locator('[data-testid*="checkout"]'))
      .first();

    await expect(checkoutButton).toBeVisible({ timeout: 10000 });
    await expect(checkoutButton).toBeEnabled({ timeout: 5000 });

    // 点击结算按钮
    await checkoutButton.click();

    // 等待跳转到结算页（不需要完成支付）
    await page
      .waitForURL(/\/checkout|\/cart\/checkout/i, { timeout: 15000 })
      .catch(() => {});
    await page.waitForLoadState("domcontentloaded");
    // 验证结算页核心元素（至少有一个）
    const checkoutForm = page
      .locator('form, .checkout-form, [data-testid="checkout"]')
      .first();
    const checkoutTitle = page
      .locator("h1, h2")
      .filter({ hasText: /checkout|结算|shipping|delivery/i })
      .first();

    const hasCheckoutForm = await checkoutForm
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasCheckoutTitle = await checkoutTitle
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(hasCheckoutForm || hasCheckoutTitle).toBeTruthy();

    // 收集网络摘要
    await attachNetworkSummary(page, test);
  });
});
