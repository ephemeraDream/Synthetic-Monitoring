import { expect, test, type Locator } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { installWebVitalsCollector } from "../utils/vitals";
import {
  applyDeterministicJourneyHeaders,
  attachJourneyEvidence,
  captureJourneyVitalsCheckpoint,
  closeMobileMenu,
  firstVisible,
  openMobileMenu,
  openStorefrontPage,
  setupJourneyDiagnostics,
} from "../utils/storefrontJourney";

test.describe("P0_HOME - 首页核心功能", () => {
  const target = getCurrentTarget();

  test("首页加载并验证核心元素", async ({ page, isMobile }, testInfo) => {
    const diagnostics = setupJourneyDiagnostics(page);

    await installWebVitalsCollector(page);
    await applyDeterministicJourneyHeaders(page);

    try {
      await openStorefrontPage(page, target.url);

      await test.step("首页基础结构可见", async () => {
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

        const searchEntry = await firstVisible(
          isMobile
            ? [
                page.locator(".header-mobile__item--search .header__search .header__icon"),
                page.locator(".header__search-full"),
                page.locator('summary[aria-label="Search"]'),
              ]
            : [
                page.locator('summary[aria-label="Search"]'),
                page.locator(".header__search-full"),
              ],
          5000,
        );
        expect(searchEntry, "首页搜索入口未出现").not.toBeNull();

        const heroHeading = await firstVisible(
          [
            page.getByRole("heading", { name: /Explore Our Bestsellers/i }),
            page.getByRole("heading", {
              name: /Blacklyte makes the best ergonomic gaming chairs and desks/i,
            }),
            page.getByRole("heading", { name: /Voice of Leaders in Community/i }),
          ],
          10000,
        );
        expect(heroHeading, "首页核心内容区未出现").not.toBeNull();

        await captureJourneyVitalsCheckpoint(page, diagnostics, "home");
      });

      await test.step("导航入口可用", async () => {
        if (isMobile) {
          await openMobileMenu(page);

          const accountEntry = await firstVisible(
            [
              page.getByRole("link", { name: /Sign In/i }),
              page.getByRole("link", { name: /Create an Account/i }),
            ],
            5000,
          );
          expect(accountEntry, "移动端菜单展开后未出现账号入口").not.toBeNull();

          await closeMobileMenu(page);
        } else {
          const desktopNav = await firstVisible(
            [
              page.locator("header nav"),
              page.getByRole("navigation"),
            ],
            5000,
          );
          expect(desktopNav, "桌面端导航未出现").not.toBeNull();

          const primaryNavLink = await firstVisible(
            [
              desktopNav!.getByRole("link", { name: /Products/i }),
              desktopNav!.getByRole("link", { name: /Chairs/i }),
              desktopNav!.getByRole("link", { name: /Desks/i }),
              desktopNav!.getByRole("link", { name: /Accessories/i }),
            ],
            5000,
          );
          expect(primaryNavLink, "桌面端关键导航链接未出现").not.toBeNull();
        }
      });
    } finally {
      await test.step("收集关键证据", async () => {
        await attachJourneyEvidence(page, testInfo, diagnostics);
      });
    }
  });
});
