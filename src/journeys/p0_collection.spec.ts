import { expect, test, type Locator, type Page } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { installWebVitalsCollector } from "../utils/vitals";
import {
  applyDeterministicJourneyHeaders,
  attachJourneyEvidence,
  captureJourneyVitalsCheckpoint,
  closeSitePopups,
  firstVisible,
  navigateByLocatorHref,
  openMobileMenu,
  openStorefrontPage,
  setupJourneyDiagnostics,
} from "../utils/storefrontJourney";

type CollectionConfig = {
  expectedCollectionText: RegExp;
  expectedProductText: RegExp;
  landingLinkText: RegExp;
  name: string;
  path: string;
};

const COLLECTIONS: CollectionConfig[] = [
  {
    name: "Chairs",
    path: "/collections/gaming-chairs",
    landingLinkText: /All Gaming Chairs/i,
    expectedCollectionText: /Blacklyte gaming chairs/i,
    expectedProductText: /Athena Pro Gaming Chair|Kraken Pro Gaming Chair|Athena Gaming Chair/i,
  },
  {
    name: "Desks",
    path: "/collections/desks",
    landingLinkText: /All Desks/i,
    expectedCollectionText: /Blacklyte desks/i,
    expectedProductText: /Atlas Desk|Atlas Lite Standing Desk/i,
  },
  {
    name: "Accessories",
    path: "/collections/accessories",
    landingLinkText: /^Accessories$/i,
    expectedCollectionText: /Blacklyte accessories/i,
    expectedProductText: /Atlas Dual Monitor Arm|Atlas Monitor Arm|Lumbar Pillow/i,
  },
];

async function openProductsLanding(
  page: Page,
  baseUrl: string,
  isMobile: boolean,
): Promise<void> {
  await openStorefrontPage(page, baseUrl);

  const productsLink = isMobile
    ? await (async () => {
        await openMobileMenu(page);

        return firstVisible(
          [
            page
              .locator('#navigation-mobile a[href="/pages/collections"]')
              .filter({ hasText: /^Products$/i })
              .first(),
            page
              .locator('.halo-sidebar a[href="/pages/collections"]')
              .filter({ hasText: /^Products$/i })
              .first(),
            page
              .locator('a[href="/pages/collections"]')
              .filter({ hasText: /^Products$/i })
              .first(),
          ],
          8000,
        );
      })()
    : await firstVisible(
        [
          page
            .locator('header nav a[href="/pages/collections"]')
            .filter({ hasText: /^Products$/i })
            .first(),
          page
            .locator('a[href="/pages/collections"]')
            .filter({ hasText: /^Products$/i })
            .first(),
        ],
        8000,
      );

  expect(productsLink, "未找到 Products 入口").not.toBeNull();

  await navigateByLocatorHref(page, productsLink!, (url) => url.pathname === "/pages/collections");
  await closeSitePopups(page);

  const landingReady = await firstVisible(
    [
      page.locator('main a[href="/collections/gaming-chairs"]').first(),
      page.locator('main a[href="/collections/desks"]').first(),
      page.locator('main a[href="/collections/accessories"]').first(),
    ],
    10000,
  );
  expect(landingReady, "Collections landing page 未出现真实分类入口").not.toBeNull();
}

async function openCollectionFromLanding(
  page: Page,
  config: CollectionConfig,
): Promise<void> {
  const collectionLink = await firstVisible(
    [
      page
        .locator(`main a[href="${config.path}"]`)
        .filter({ hasText: config.landingLinkText })
        .first(),
      page
        .locator(`a[href="${config.path}"]`)
        .filter({ hasText: config.landingLinkText })
        .first(),
    ],
    10000,
  );
  expect(collectionLink, `未找到 ${config.name} 分类入口`).not.toBeNull();

  await navigateByLocatorHref(page, collectionLink!, (url) => url.pathname === config.path);
  await closeSitePopups(page);
}

async function assertCollectionPage(
  page: Page,
  config: CollectionConfig,
): Promise<void> {
  await expect(page.locator("main")).toBeVisible({ timeout: 10000 });

  const collectionTitle = await firstVisible(
    [
      page
        .locator(".collection_head_new_select_title")
        .filter({ hasText: config.expectedCollectionText })
        .first(),
      page.locator("main").getByText(config.expectedCollectionText).first(),
    ],
    8000,
  );

  const mainHasCollectionText = await expect
    .poll(
      async () => {
        const text = await page.locator("main").textContent().catch(() => null);
        return config.expectedCollectionText.test(text ?? "");
      },
      {
        timeout: 10000,
        message: `${config.name} 分类页主内容未出现预期标题`,
      },
    )
    .toBeTruthy()
    .then(() => true)
    .catch(() => false);

  expect(
    collectionTitle !== null || mainHasCollectionText,
    `${config.name} 分类页标题未出现`,
  ).toBeTruthy();

  const productGrid = await firstVisible(
    [
      page.locator(".collection-banner-adv .collection .productGrid").first(),
      page.locator(".new-chairs-collection-section .productGrid").first(),
      page.locator(".productGrid").first(),
    ],
    10000,
  );
  expect(productGrid, `${config.name} 分类页商品列表容器未出现`).not.toBeNull();

  const productLink = await firstVisible(
    [
      page
        .locator("main a[href*='/products/']")
        .filter({ hasText: config.expectedProductText })
        .first(),
      page
        .locator(".variable-products a[href*='/products/']")
        .filter({ hasText: config.expectedProductText })
        .first(),
      page
        .locator(".product-item a[href*='/products/']")
        .filter({ hasText: config.expectedProductText })
        .first(),
    ],
    10000,
  );
  expect(productLink, `${config.name} 分类页未出现真实商品链接`).not.toBeNull();

  const visibleProductCards = await page
    .locator(".variable-products, .product-item")
    .evaluateAll((nodes) =>
      nodes.filter(
        (node) =>
          node instanceof HTMLElement &&
          !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      ).length,
    )
    .catch(() => 0);
  expect(visibleProductCards, `${config.name} 分类页没有可见商品卡`).toBeGreaterThan(0);
}

test.describe("P0_COLLECTION - 分类页列表", () => {
  const target = getCurrentTarget();

  for (const collection of COLLECTIONS) {
    test(`分类页加载: ${collection.name}`, async ({ page, isMobile }, testInfo) => {
      const diagnostics = setupJourneyDiagnostics(page);

      await installWebVitalsCollector(page);
      await applyDeterministicJourneyHeaders(page);

      try {
        await test.step("从首页进入 Products landing page", async () => {
          await openProductsLanding(page, target.url, isMobile);
          await captureJourneyVitalsCheckpoint(page, diagnostics, "collections-landing");
        });

        await test.step(`进入 ${collection.name} 分类页`, async () => {
          await openCollectionFromLanding(page, collection);
        });

        await test.step(`${collection.name} 分类页列表真实加载`, async () => {
          await assertCollectionPage(page, collection);
          await captureJourneyVitalsCheckpoint(
            page,
            diagnostics,
            `collection-${collection.name.toLowerCase()}`,
          );
        });
      } finally {
        await test.step("收集关键证据", async () => {
          await attachJourneyEvidence(page, testInfo, diagnostics);
        });
      }
    });
  }
});
