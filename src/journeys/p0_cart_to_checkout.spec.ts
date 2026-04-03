import { test } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { pick, LOCALES } from "../utils/random";
import { installWebVitalsCollector } from "../utils/vitals";
import {
  addCurrentProductToCart,
  ATHENA_PRO_SLUG,
  ATHENA_PRO_TITLE,
  attachJourneyEvidence,
  goToCart,
  goToCheckout,
  openProductPdp,
  openStorefrontPage,
  setupJourneyDiagnostics,
} from "../utils/storefrontJourney";

test.describe("P0_CART_TO_CHECKOUT - 购物车到结算", () => {
  const target = getCurrentTarget();

  test("购物车到结算流程", async ({ page, isMobile }, testInfo) => {
    const diagnostics = setupJourneyDiagnostics(page);

    await installWebVitalsCollector(page);
    await page.setExtraHTTPHeaders({ "Accept-Language": pick(LOCALES) });

    try {
      await openStorefrontPage(page, target.url);

      await test.step("进入 Athena Pro 商品详情页", async () => {
        await openProductPdp(page, target.url, ATHENA_PRO_SLUG, ATHENA_PRO_TITLE);
      });

      await test.step("PDP 加购成功", async () => {
        await addCurrentProductToCart(page);
      });

      await test.step("进入购物车", async () => {
        await goToCart(page, isMobile);
      });

      await test.step("进入 checkout", async () => {
        await goToCheckout(page);
      });
    } finally {
      await test.step("收集关键证据", async () => {
        await attachJourneyEvidence(page, testInfo, diagnostics);
      });
    }
  });
});
