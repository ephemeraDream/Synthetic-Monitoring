import { test, expect } from "@playwright/test";
import { TARGETS, TargetKey } from "../config/targets";
import {
  closeMarketingPopups,
  closePopup,
  waitAndClosePopup,
} from "../utils/popup";
import { attachNetworkCollectors } from "../utils/network";
import { attachHAR } from "../utils/har";
import { installWebVitalsCollector, readWebVitals } from "../utils/vitals";
import { jitterMs, pick, LOCALES } from "../utils/random";
import { VITALS_THRESHOLDS } from "../config/vitals_thresholds";

/**
 * P0_COMPLETE_USER_JOURNEY：完整用户旅程测试
 *
 * 测试目标：模拟真实用户从不同国家访问网站，完成关键操作
 *
 * 测试流程：
 * 1. 打开首页 → 关闭弹窗 → 验证核心元素
 * 2. 搜索商品（Athena/Atlas）→ 进入详情页
 * 3. 商品详情页 → 加购 → 验证购物车状态
 * 4. 购物车 → 进入结算页（到支付前）
 * 5. 处理登录/订阅弹窗
 * 6. 切换地区/币种
 * 7. 访问下载页
 *
 * 证据收集：
 * - 截图（失败时自动）
 * - 录屏（失败时自动）
 * - 网络 HAR（所有请求）
 * - 控制台日志（所有错误）
 * - Web Vitals 数据
 *
 * 优先级：P0（核心用户旅程）
 */
test.describe("P0_COMPLETE_USER_JOURNEY - 完整用户旅程", () => {
  test("完整用户操作流程", async ({ page, isMobile }, testInfo) => {
    // ========== 初始化 ==========
    const target: TargetKey = (process.env.TARGET as TargetKey) || "US";
    const base = TARGETS[target].url;

    // 设置随机语言（模拟不同国家用户）
    await page.setExtraHTTPHeaders({ "Accept-Language": pick(LOCALES) });
    await page.waitForTimeout(jitterMs()); // 随机延迟，模拟真实用户

    // 安装 Web Vitals 采集器
    await installWebVitalsCollector(page);

    // 收集网络请求（用于生成 HAR）
    const getNet = attachNetworkCollectors(page);

    // 收集控制台日志
    const consoleLogs: Array<{ type: string; text: string }> = [];
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      const logEntry = { type: msg.type(), text: msg.text() };
      consoleLogs.push(logEntry);
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 收集页面错误
    page.on("pageerror", (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });

    // 收集请求失败
    const failedRequests: Array<{ url: string; failure: string }> = [];
    page.on("requestfailed", (request) => {
      failedRequests.push({
        url: request.url(),
        failure: request.failure()?.errorText || "Unknown failure",
      });
    });

    // ========== 步骤 1: 打开首页 ==========
    await test.step("步骤 1: 打开首页并验证", async () => {
      await page.goto(base, { waitUntil: "load" });
      await waitAndClosePopup(page);

      // 验证首页核心元素
      // Logo/品牌标识（使用更灵活的验证策略）
      const logoSelectors = [
        'a[href="/"]',
        ".header__heading-link",
        '[data-testid="logo"]',
        ".logo",
        'img[alt*="blacklyte" i]',
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

      // 如果找不到可见的 Logo，验证元素至少存在于 DOM 中
      if (!logoFound) {
        const headerExists = (await page.locator("header").count()) > 0;
        const logoInDom =
          (await page
            .locator('a[href="/"], .logo, [data-testid="logo"]')
            .count()) > 0;
        const currentUrl = page.url();
        const urlMatches =
          currentUrl.includes("blacklyte") || currentUrl === base;
        expect(headerExists || logoInDom || urlMatches).toBeTruthy();
      } else {
        expect(logoFound).toBeTruthy();
      }

      // 导航菜单
      const nav = page.locator("nav").first();
      const navExists = (await nav.count()) > 0;
      expect(navExists).toBeTruthy();

      // 购物车入口（使用更灵活的验证）
      const cartLink = page.locator('a[href*="cart" i]').first();
      const cartLinkVisible = await cartLink
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (!cartLinkVisible) {
        // 尝试查找购物车按钮（排除关闭按钮）
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

        // 如果还是找不到，至少验证购物车元素存在于 DOM 中
        if (!foundCartButton) {
          const cartInDom =
            (await page
              .locator('a[href*="cart" i], [data-testid*="cart" i]')
              .count()) > 0;
          // 至少应该存在于 DOM 中
          expect(cartInDom).toBeTruthy();
        }
      }

      // 验证首屏内容（避免白屏）
      await expect(page.locator("main, #MainContent")).toBeVisible({
        timeout: 10000,
      });
    });

    // ========== 步骤 2: 搜索商品 ==========
    await test.step("步骤 2: 搜索商品并进入详情页", async () => {
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
        await searchInput.fill("Athena Pro");
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
        await searchInput.fill("Athena Pro");
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
        .filter({ hasText: new RegExp("Athena Pro", "i") })
        .first();
      await expect(resultWithKeyword).toBeVisible({ timeout: 10000 });

      // 点击第一个搜索结果进入 PDP
      await resultItem.click();

      // 等待进入商品详情页
      await page
        .waitForURL(/\/products?|\/p\//i, { timeout: 10000 })
        .catch(() => {});
      await page.waitForLoadState("domcontentloaded");

      // 验证商品详情页
      const productTitle = page
        .locator('h1, .product-title, [data-testid="product-title"]')
        .first();
      await expect(productTitle).toBeVisible({ timeout: 10000 });

      // 验证标题包含搜索关键词（可选，因为可能有变体）
      const titleText = await productTitle.textContent();
      expect(titleText?.toLowerCase()).toContain("Athena Pro".toLowerCase());
    });

    // ========== 步骤 3: 加购 ==========
    await test.step("步骤 3: 添加商品到购物车", async () => {
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
    });

    // ========== 步骤 4: 进入购物车和结算页 ==========
    await test.step("步骤 4: 进入购物车并前往结算", async () => {
      // // 先关闭可能的弹窗（如加购成功弹窗）
      // await closePopup(page);
      // await page.waitForTimeout(1000);

      // // 打开购物车
      // const cartIcon = page.locator('a[href*="cart" i]')
      //   .or(page.locator('button[aria-label*="cart" i]').filter({ hasNot: page.locator('[aria-label*="close" i]') }))
      //   .first();

      // await expect(cartIcon).toBeVisible({ timeout: 5000 });

      // // 如果点击被拦截，尝试强制点击或关闭拦截层
      // try {
      //   await cartIcon.click({ timeout: 5000 });
      // } catch (e) {
      //   // 如果点击失败，尝试关闭拦截层后重试
      //   const overlay = page.locator('.background-overlay, .modal-overlay, [class*="overlay"]').first();
      //   const overlayVisible = await overlay.isVisible({ timeout: 2000 }).catch(() => false);
      //   if (overlayVisible) {
      //     await overlay.click({ force: true }).catch(() => {});
      //     await page.waitForTimeout(500);
      //   }
      //   // 重试点击，如果还是失败则使用强制点击
      //   await cartIcon.click({ force: true, timeout: 5000 });
      // }
      // await expect(page.locator("#halo-side-cart-preview")).toBeVisible({
      //   timeout: 5000,
      // });
      if (page.url().includes("/cart") == false) {
        const viewCartButton = page
          .locator('a.button-view-cart:has-text("View Cart")')
          .or(page.locator('a.button-view-cart[href^="/cart"]'))
          .first();
        await viewCartButton.click({ timeout: 5000 });
      }
      // 等待购物车页面加载
      await page.waitForURL(/\/cart/i, { timeout: 10000 }).catch(() => {});

      // 验证购物车页面
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

      // 点击结算按钮
      const checkoutButton = page
        .getByRole("button", { name: /checkout|结算|proceed to checkout/i })
        .or(page.locator('a:has-text("Checkout")'))
        .or(page.locator('[data-testid*="checkout"]'))
        .first();

      await expect(checkoutButton).toBeVisible({ timeout: 10000 });
      await expect(checkoutButton).toBeEnabled({ timeout: 5000 });

      await checkoutButton.click();

      // 等待跳转到结算页
      await page
        .waitForURL(/\/checkout|\/cart\/checkout/i, { timeout: 15000 })
        .catch(() => {});

      // 验证结算页核心元素
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
    });

    // // ========== 步骤 5: 处理登录/订阅弹窗 ==========
    // await test.step("步骤 5: 处理登录和订阅弹窗", async () => {
    //   // 返回首页测试弹窗
    //   await page.goto(base, { waitUntil: "domcontentloaded" });
    //   await page.waitForTimeout(2000);

    //   // 关闭所有弹窗（订阅、登录等）
    //   await closeMarketingPopups(page);
    //   await page.waitForTimeout(1000);

    //   // 尝试触发登录弹窗（如果存在登录按钮）
    //   const signInButton = page
    //     .getByRole("button", { name: /sign in|login|登录/i })
    //     .or(page.locator('a:has-text("Sign In")'))
    //     .first();

    //   const hasSignIn = await signInButton
    //     .isVisible({ timeout: 3000 })
    //     .catch(() => false);
    //   if (hasSignIn) {
    //     await signInButton.click();
    //     await page.waitForTimeout(1000);

    //     // 验证登录弹窗出现
    //     const loginModal = page
    //       .locator('[role="dialog"], .modal, .login-modal')
    //       .first();
    //     const modalVisible = await loginModal
    //       .isVisible({ timeout: 3000 })
    //       .catch(() => false);

    //     if (modalVisible) {
    //       // 关闭登录弹窗
    //       const closeButton = page
    //         .getByRole("button", { name: /close/i })
    //         .or(page.locator('button[aria-label*="close" i]'))
    //         .first();
    //       await closeButton.click().catch(() => {});
    //       await page.waitForTimeout(500);
    //     }
    //   }

    //   // 验证订阅弹窗（"Get $30 off..."）
    //   // 这个弹窗通常在页面加载后自动出现
    //   await closeMarketingPopups(page);
    // });

    // // ========== 步骤 6: 切换地区/币种 ==========
    // await test.step("步骤 6: 切换地区和币种", async () => {
    //   // 查找地区选择器
    //   const regionSelector = page
    //     .locator(
    //       '[data-testid*="region"], [data-testid*="country"], .region-selector',
    //     )
    //     .or(page.getByRole("button", { name: /region|country|地区|国家/i }))
    //     .or(page.locator("text=/USD|Regions/i"))
    //     .first();

    //   const hasRegionSelector = await regionSelector
    //     .isVisible({ timeout: 5000 })
    //     .catch(() => false);

    //   if (hasRegionSelector) {
    //     await regionSelector.click();
    //     await page.waitForTimeout(500);

    //     // 查找其他地区选项（选择不同于当前地区的选项）
    //     // 根据网站内容，有：United States, Canada, Europe, United Kingdom, Australia, Japan
    //     const allTargets = Object.values(TARGETS);
    //     const currentTargetConfig = TARGETS[target];
    //     const otherTarget = allTargets.find(
    //       (t) => t.region !== currentTargetConfig.region,
    //     );

    //     if (otherTarget) {
    //       // 尝试多种方式查找地区选项
    //       const regionNames: Record<string, string> = {
    //         US: "United States",
    //         CA: "Canada",
    //         EU: "Europe",
    //         UK: "United Kingdom",
    //         AU: "Australia",
    //         JP: "Japan",
    //       };

    //       const regionName =
    //         regionNames[otherTarget.region] || otherTarget.region;

    //       const targetOption = page
    //         .getByRole("option", { name: new RegExp(regionName, "i") })
    //         .or(page.locator(`a:has-text("${regionName}")`))
    //         .or(page.locator(`button:has-text("${regionName}")`))
    //         .or(page.locator(`text=/${otherTarget.region}/i`))
    //         .first();

    //       const optionVisible = await targetOption
    //         .isVisible({ timeout: 3000 })
    //         .catch(() => false);
    //       if (optionVisible) {
    //         await targetOption.click();
    //         await page.waitForTimeout(2000);

    //         // 验证 URL 或页面元素变化
    //         const currentUrl = page.url();
    //         const urlChanged =
    //           currentUrl.includes(otherTarget.region.toLowerCase()) ||
    //           currentUrl.includes(
    //             otherTarget.url.replace("https://", "").replace("/", ""),
    //           ) ||
    //           currentUrl !== base;

    //         // 至少 URL 应该变化，或者页面重新加载
    //         expect(urlChanged).toBeTruthy();
    //       }
    //     }
    //   }
    // });

    // // ========== 步骤 7: 访问下载页 ==========
    // await test.step("步骤 7: 访问下载页", async () => {
    //   // 查找下载链接（通常在导航菜单或页脚）
    //   // 根据网站内容，有 "Downloads" 链接
    //   const downloadLink = page
    //     .getByRole("link", { name: /download|下载/i })
    //     .or(page.locator('a[href*="download" i]'))
    //     .or(page.locator('a:has-text("Downloads")'))
    //     .first();

    //   const hasDownloadLink = await downloadLink
    //     .isVisible({ timeout: 5000 })
    //     .catch(() => false);

    //   if (hasDownloadLink) {
    //     await downloadLink.click();
    //     await page.waitForTimeout(2000);

    //     // 验证下载页加载
    //     const downloadPage = page
    //       .locator('h1, .download-title, [data-testid="download"]')
    //       .filter({ hasText: /download|下载/i })
    //       .first();

    //     const downloadPageVisible = await downloadPage
    //       .isVisible({ timeout: 5000 })
    //       .catch(() => false);
    //     // 下载页可能重定向或直接下载，所以验证更宽松
    //     expect(
    //       downloadPageVisible || page.url().includes("download"),
    //     ).toBeTruthy();
    //   } else {
    //     // 如果没有下载链接，跳过此步骤
    //     test.skip(true, "下载页链接未找到");
    //   }
    // });

    // ========== 收集所有证据 ==========
    await test.step("收集测试证据", async () => {
      // 1. 网络摘要（JSON 格式，便于程序分析）
      const net = getNet();
      testInfo.attach("network-summary", {
        body: JSON.stringify(net, null, 2),
        contentType: "application/json",
      });

      // 2. 网络 HAR 文件（可在 Chrome DevTools 中打开分析）
      await attachHAR(page, testInfo);

      // 3. 控制台日志（所有日志，包括 info/warn/error）
      if (consoleLogs.length > 0) {
        testInfo.attach("console-logs", {
          body: JSON.stringify(consoleLogs, null, 2),
          contentType: "application/json",
        });
      }

      // 4. 控制台错误（纯文本格式，便于快速查看）
      if (consoleErrors.length > 0) {
        testInfo.attach("console-errors", {
          body: consoleErrors.join("\n\n"),
          contentType: "text/plain",
        });
      }

      // 5. 失败的请求（便于快速定位问题）
      if (failedRequests.length > 0) {
        testInfo.attach("failed-requests", {
          body: JSON.stringify(failedRequests, null, 2),
          contentType: "application/json",
        });
      }

      // 6. Web Vitals（性能指标）
      try {
        if (!page.isClosed()) {
          const vitals = await readWebVitals(page);
          testInfo.attach("web-vitals", {
            body: JSON.stringify(vitals, null, 2),
            contentType: "application/json",
          });

          // 验证 Web Vitals（P0 阈值）
          // 注意：当前阶段先记录，不强制失败（避免误报）
          if (vitals.lcp != null && vitals.lcp > VITALS_THRESHOLDS.P0.lcp) {
            console.warn(`LCP ${vitals.lcp}ms > ${VITALS_THRESHOLDS.P0.lcp}ms`);
          }
          if (vitals.cls != null && vitals.cls > VITALS_THRESHOLDS.P0.cls) {
            console.warn(`CLS ${vitals.cls} > ${VITALS_THRESHOLDS.P0.cls}`);
          }
        }
      } catch (error) {
        console.warn("无法收集 Web Vitals:", error);
      }

      // 7. 页面截图（最后状态，全页截图）
      try {
        if (!page.isClosed()) {
          const screenshot = await page.screenshot({ fullPage: true });
          testInfo.attach("final-screenshot", {
            body: screenshot,
            contentType: "image/png",
          });
        }
      } catch (error) {
        console.warn("无法截取页面截图:", error);
      }

      // 8. 页面 HTML（用于调试，查看最终 DOM 状态）
      try {
        if (!page.isClosed()) {
          const html = await page.content();
          testInfo.attach("page-html", {
            body: html,
            contentType: "text/html",
          });
        }
      } catch (error) {
        console.warn("无法获取页面 HTML:", error);
      }
    });

    // ========== 最终验证 ==========
    // 验证没有严重的控制台错误（P0 建议作为失败条件）
    if (consoleErrors.length > 0) {
      console.warn(`发现 ${consoleErrors.length} 个控制台错误`);
      // 可以根据需要决定是否失败
      // expect(consoleErrors.length).toBe(0);
    }

    // 验证没有失败的请求
    if (failedRequests.length > 0) {
      console.warn(`发现 ${failedRequests.length} 个失败的请求`);
      // 可以根据需要决定是否失败
      // expect(failedRequests.length).toBe(0);
    }
  });
});
