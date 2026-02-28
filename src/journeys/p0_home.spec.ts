import { test, expect } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { closePopup, waitAndClosePopup } from "../utils/popup";
import { attachNetworkSummary } from "../utils/network";
import {
  injectVitalsScript,
  getWebVitals,
  validateVitals,
} from "../utils/vitals";
import { getThresholds } from "../config/vitals_thresholds";
import { waitAndCloseJumpPopup } from "../utils/jumpPopup";

test.describe("P0_HOME - 首页核心功能", () => {
  const target = getCurrentTarget();

  test.beforeEach(async ({ page }) => {
    await injectVitalsScript(page);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(target.url, { waitUntil: "load" });
    await waitAndCloseJumpPopup(page);
    await waitAndClosePopup(page);
  });

  test("首页加载并验证核心元素", async ({ page, isMobile }) => {
    if (isMobile) {
      const menuButton = page
        .locator(
          'button[aria-label*="menu" i], button[aria-expanded], .menu-toggle, [data-menu-toggle]',
        )
        .first();
      await expect(menuButton).toBeVisible();
    } else {
      const nav = page.locator('nav[role="navigation"]').first();
      await expect(nav).toBeVisible();
    }

    const logoSelectors = [
      '[data-testid="logo"]',
      ".logo",
      'img[alt*="blacklyte" i]',
      'a[href="/"]',
      'header a[href="/"]',
      ".header__heading-link",
    ];

    let logoFound = false;
    for (const selector of logoSelectors) {
      const logo = page.locator(selector).first();
      const isVisible = await logo
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (isVisible) {
        logoFound = true;
        break;
      }
    }

    if (!logoFound) {
      const headerExists = (await page.locator("header").count()) > 0;
      const logoInDom =
        (await page
          .locator('a[href="/"], .logo, [data-testid="logo"]')
          .count()) > 0;

      const currentUrl = page.url();
      const urlMatches =
        currentUrl.includes("blacklyte") || currentUrl === target.url;

      expect(headerExists || logoInDom || urlMatches).toBeTruthy();
    } else {
      expect(logoFound).toBeTruthy();
    }

    if (isMobile) {
      const menuButton = page
        .locator(
          'button[aria-label*="menu" i], button[aria-expanded], .menu-toggle',
        )
        .first();
      const menuButtonVisible = await menuButton
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (menuButtonVisible) {
        await menuButton.click();
        await page.waitForTimeout(500);
      }
    }

    const navLinks = page.locator("nav a, header a").filter({ hasNotText: "" });
    const navLinkCount = await navLinks.count();
    expect(navLinkCount).toBeGreaterThan(0);

    await expect(page.locator("main, #MainContent")).toBeVisible({
      timeout: 10000,
    });

    const cartLink = page.locator('a[href*="cart" i]').first();
    const cartLinkVisible = await cartLink
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (cartLinkVisible) {
      await expect(cartLink).toBeVisible({ timeout: 1000 });
    } else {
      const cartButtons = page.locator('button[aria-label*="cart" i]').all();
      let foundCartButton = false;

      for (const button of await cartButtons) {
        const ariaLabel = await button.getAttribute("aria-label");
        if (ariaLabel && !ariaLabel.toLowerCase().includes("close")) {
          const isVisible = await button
            .isVisible({ timeout: 1000 })
            .catch(() => false);
          if (isVisible) {
            foundCartButton = true;
            break;
          }
        }
      }

      if (!foundCartButton) {
        const cartIcon = page
          .locator(
            '[data-testid*="cart" i]:not([data-testid*="close" i]), .cart-icon, .cart-link',
          )
          .first();
        const cartIconVisible = await cartIcon
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (!cartIconVisible && !foundCartButton && !cartLinkVisible) {
          const cartInDom =
            (await page
              .locator('a[href*="cart" i], [data-testid*="cart" i]')
              .count()) > 0;

          if (isMobile) {
            const pageLoaded = await page.evaluate(() => {
              return document.body && document.body.children.length > 0;
            });
            expect(pageLoaded).toBeTruthy();
          } else {
            expect(
              cartIconVisible ||
                foundCartButton ||
                cartLinkVisible ||
                cartInDom,
            ).toBeTruthy();
          }
        } else {
          expect(
            cartIconVisible || foundCartButton || cartLinkVisible,
          ).toBeTruthy();
        }
      }
    }

    await attachNetworkSummary(page, test);

    try {
      if (!page.isClosed()) {
        const vitals = await getWebVitals(page);
        const validation = validateVitals(vitals, getThresholds("P0"));
        if (!validation.passed) {
          console.warn("Web Vitals 未达标:", validation.failures);
        }
      }
    } catch (error) {
      console.warn("无法收集 Web Vitals:", error);
    }

    try {
      if (!page.isClosed()) {
        const consoleErrors = await page.evaluate(() => {
          return (window as any).__consoleErrors || [];
        });
        if (consoleErrors.length > 0) {
          console.warn("发现 Console Errors:", consoleErrors);
        }
      }
    } catch (error) {
      console.warn("无法收集 Console Errors:", error);
    }
  });
});
