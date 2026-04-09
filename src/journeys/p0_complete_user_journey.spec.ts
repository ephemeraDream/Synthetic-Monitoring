import { expect, test, type Locator } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { installWebVitalsCollector } from "../utils/vitals";
import {
  addCurrentProductToCart,
  applyDeterministicJourneyHeaders,
  ATHENA_PRO_SLUG,
  ATHENA_PRO_TITLE,
  attachJourneyEvidence,
  captureJourneyVitalsCheckpoint,
  closeSitePopups,
  firstVisible,
  goToCart,
  goToCheckout,
  navigateByLocatorHref,
  openSearchInput,
  openStorefrontPage,
  setupJourneyDiagnostics,
  submitSearch,
} from "../utils/storefrontJourney";

const SEARCH_KEYWORD = "Athena Pro";

test.describe("P0_COMPLETE_USER_JOURNEY - 完整用户旅程", () => {
  const target = getCurrentTarget();

  test("首页 -> 搜索 -> PDP -> cart -> checkout", async ({ page, isMobile }, testInfo) => {
    const diagnostics = setupJourneyDiagnostics(page);

    await installWebVitalsCollector(page);
    await applyDeterministicJourneyHeaders(page);

    try {
      await openStorefrontPage(page, target.url);

      await test.step("首页基础元素可见", async () => {
        await expect(page.locator("main")).toBeVisible({ timeout: 10000 });

        const logo = await firstVisible(
          [
            page.getByRole("link", { name: /Blacklyte/i }),
            page.locator('a[href="/"] img[alt*="blacklyte" i]'),
            page.locator('a[href="/"]'),
          ],
          5000,
        );
        expect(logo, "首页 Logo 未出现").not.toBeNull();

        const cartLink = await firstVisible(
          [
            page.locator('a[href="/cart"].cart-icon-bubble'),
            page.getByRole("link", { name: /Cart .*item/i }),
            page.locator('a[href="/cart"]'),
          ],
          5000,
        );
        expect(cartLink, "首页购物车入口未出现").not.toBeNull();

        await captureJourneyVitalsCheckpoint(page, diagnostics, "home");
      });

      await test.step("搜索 Athena Pro 并进入商品详情页", async () => {
        const searchInput = await openSearchInput(page, isMobile);
        await submitSearch(page, searchInput, SEARCH_KEYWORD, isMobile);

        const searchHeading = await firstVisible(
          [
            page.locator("h1.page-header").filter({ hasText: /Athena Pro/i }).first(),
            page.getByRole("heading", { name: /results found for/i }).first(),
          ],
          10000,
        );
        expect(searchHeading, "搜索结果标题未出现").not.toBeNull();

        const resultLink = await firstVisible(
          [
            page
              .locator(`main a.product_categories_product[href*="${ATHENA_PRO_SLUG}"]`)
              .first(),
            page.locator(`main a[href*="${ATHENA_PRO_SLUG}?variant="]`).first(),
            page
              .locator(`main a[href*="${ATHENA_PRO_SLUG}"]`)
              .filter({ hasText: /Athena Pro/i })
              .first(),
          ],
          10000,
        );
        expect(resultLink, "未找到 Athena Pro 搜索结果").not.toBeNull();

        await captureJourneyVitalsCheckpoint(page, diagnostics, "search-results");

        await navigateByLocatorHref(
          page,
          resultLink!,
          new RegExp(`/products/${ATHENA_PRO_SLUG}(?:[/?#]|$)`, "i"),
          15000,
        );
        await closeSitePopups(page);

        const productTitle = await firstVisible(
          [
            page.locator("main").getByText(ATHENA_PRO_TITLE, { exact: true }).first(),
            page
              .locator(".product_info_new_product_title, .product_info_new_right_title, h1")
              .filter({ hasText: ATHENA_PRO_TITLE })
              .first(),
          ],
          10000,
        );
        expect(productTitle, "PDP 标题未出现").not.toBeNull();

        await captureJourneyVitalsCheckpoint(page, diagnostics, "pdp");
      });

      await test.step("PDP 加购成功", async () => {
        await addCurrentProductToCart(page);
      });

      await test.step("进入购物车", async () => {
        await goToCart(page, isMobile);
        await captureJourneyVitalsCheckpoint(page, diagnostics, "cart");
      });

      await test.step("进入 checkout", async () => {
        await goToCheckout(page);
        await captureJourneyVitalsCheckpoint(page, diagnostics, "checkout");
      });
    } finally {
      await test.step("收集关键证据", async () => {
        await attachJourneyEvidence(page, testInfo, diagnostics);
      });
    }
  });
});
