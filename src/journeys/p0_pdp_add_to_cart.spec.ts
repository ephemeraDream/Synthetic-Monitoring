import { test, expect } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { closePopup, waitAndClosePopup } from "../utils/popup";
import { attachNetworkSummary } from "../utils/network";
import { injectVitalsScript } from "../utils/vitals";
import { waitRandom } from "../utils/random";

/**
 * P0_PDP_ADD_TO_CART：商品详情页 -> Add to Cart -> cart 状态变化
 */
test.describe("P0_PDP_ADD_TO_CART - 商品加购", () => {
  const target = getCurrentTarget();

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);
    await page.goto(target.url, { waitUntil: "load" });
    await waitAndClosePopup(page);
  });

  test("进入商品详情页并添加到购物车", async ({ page }) => {
    // 方法1：从首页点击第一个商品
    const firstProduct = page.locator(".link-cont").first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    // 等待进入商品详情页
    await page
      .waitForURL(/\/products?|\/p\//i, { timeout: 10000 })
      .catch(() => {});
    await page.waitForLoadState("domcontentloaded");

    // 验证商品详情页核心元素
    const productTitle = page
      .locator('h1, .product-title, [data-testid="product-title"]')
      .first();
    await expect(productTitle).toBeVisible({ timeout: 10000 });

    // 验证价格存在（但不依赖具体价格值）
    const price = page
      .locator(".product_infor_simplicity_right_buybox_price_info_discount")
      .first();
    await expect(price).toBeVisible({ timeout: 5000 });

    // 1️⃣ 找加购按钮（更简洁）
    const addToCartButton = page
      .getByRole("button", {
        name: /add to cart|加入购物车|buy now|立即购买/i,
      })
      .first();

    await expect(addToCartButton).toBeVisible({ timeout: 10000 });

    // 2️⃣ 记录购物车数量（如果存在）
    const cartCountLocator = page
      .locator("[data-cart-count], .cart-count-bubble, .cart-badge")
      .first();

    const cartCountBefore = await cartCountLocator
      .textContent()
      .catch(() => null);

    const currentUrl = page.url();

    // 3️⃣ 点击 + 同时监听可能的跳转
    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => {}),
      addToCartButton.click(),
    ]);

    // 4️⃣ 成功判断方式一：跳转到 /cart
    if (page.url().includes("/cart")) {
      await expect(
        page
          .locator(".cart-item, .line-item, [data-testid*='cart-item']")
          .first(),
      ).toBeVisible({ timeout: 5000 });
      return;
    }

    // 5️⃣ 成功判断方式二：购物车数量变化
    let cartChanged = false;

    if (cartCountBefore) {
      await expect(cartCountLocator)
        .not.toHaveText(cartCountBefore, {
          timeout: 5000,
        })
        .then(() => {
          cartChanged = true;
        })
        .catch(() => {});
    }

    // 6️⃣ 成功判断方式三：cart drawer 出现
    const cartDrawerVisible = await page
      .locator("#halo-side-cart-preview")
      .first()
      .isVisible()
      .catch(() => false);

    const success = cartChanged || cartDrawerVisible;

    if (!success) {
      console.log("加购验证失败", {
        before: cartCountBefore,
        after: await cartCountLocator.textContent().catch(() => null),
        url: page.url(),
      });
    }

    expect(success).toBeTruthy();

    // 收集网络摘要
    await attachNetworkSummary(page, test);
  });
});
