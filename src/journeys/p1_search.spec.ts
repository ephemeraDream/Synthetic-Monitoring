import { expect, test, type Locator, type Page } from "@playwright/test";
import { getCurrentTarget } from "../config/targets";
import { installWebVitalsCollector } from "../utils/vitals";
import {
  applyDeterministicJourneyHeaders,
  assertSearchResultsReady,
  attachJourneyEvidence,
  captureJourneyVitalsCheckpoint,
  closeSitePopups,
  firstVisible,
  isTemporaryErrorPage,
  navigateByLocatorHref,
  openSearchInput,
  openStableStorefrontPage,
  setupJourneyDiagnostics,
  submitSearch,
} from "../utils/storefrontJourney";

type SearchCase = {
  expectedPdpTitle: RegExp;
  expectedResultText: RegExp;
  resultSlugs: string[];
  term: string;
};

const SEARCH_CASES: SearchCase[] = [
  {
    term: "Athena Pro",
    resultSlugs: ["blacklyte-athena-pro-gaming-chair"],
    expectedResultText: /Athena Pro Gaming Chair/i,
    expectedPdpTitle: /Athena Pro Gaming Chair/i,
  },
  {
    term: "Desk",
    resultSlugs: ["blacklyte-atlas-lite-desk", "blacklyte-desk"],
    expectedResultText: /Atlas Lite Standing Desk|Atlas Desk/i,
    expectedPdpTitle: /Atlas Lite Standing Desk|Atlas Desk/i,
  },
];

async function openSearchResultsPage(
  page: Page,
  baseUrl: string,
  term: string,
  isMobile: boolean,
): Promise<void> {
  const readyLocators = isMobile
    ? [
        page.locator(".header-mobile__item--search .header__search").first(),
        page.locator(".header-mobile__item--search").first(),
        page.locator(".header-mobile__item--search .header__search .header__icon").first(),
        page.locator('a[href="/"]').first(),
      ]
    : [
        page.locator('summary[aria-label="Search"]').first(),
        page.locator(".header__search-full").first(),
        page.locator('a[href="/"]').first(),
      ];

  for (let attempt = 0; attempt < 2; attempt++) {
    await openStableStorefrontPage(page, baseUrl, readyLocators, {
      readyMessage: "首页核心入口未出现",
      readyTimeout: 5000,
    });

    const searchInput = await openSearchInput(page, isMobile);
    await submitSearch(page, searchInput, term, isMobile);

    if (!(await isTemporaryErrorPage(page))) {
      return;
    }

    await page.waitForTimeout(1000);
  }

  expect(
    await isTemporaryErrorPage(page),
    `${term} 搜索结果页仍然停留在站点错误页`,
  ).toBeFalsy();
}

function buildExpectedProductUrl(caseConfig: SearchCase): RegExp {
  return new RegExp(
    `/products/(?:${caseConfig.resultSlugs.join("|")})(?:[/?#]|$)`,
    "i",
  );
}

async function assertSearchResults(
  page: Page,
  caseConfig: SearchCase,
): Promise<Locator> {
  await assertSearchResultsReady(page, caseConfig.term);

  const main = page.getByRole("main");
  const visibleProducts = main.locator('a[href*="/products/"]').filter({ visible: true });
  const viewAll = main
    .getByRole("button", { name: /^view all$/i })
    .and(main.locator('[data-search-view-all][data-target^="SearchProductResults-"]'))
    .first();

  // 新版仅展示部分变体，有展开入口时验证它确实显示了更多商品。
  if (await viewAll.isVisible()) {
    const initialCount = await visibleProducts.count();
    await closeSitePopups(page, 800);
    await viewAll.click();
    await expect(viewAll, "展开商品结果后 View All 按钮未收起").toBeHidden();
    await expect
      .poll(() => visibleProducts.count(), {
        message: "View All 未展示更多商品结果",
      })
      .toBeGreaterThan(initialCount);
  }

  const resultLink = main
    .getByRole("link", { name: caseConfig.expectedResultText })
    .and(
      main.locator(
        caseConfig.resultSlugs.map((slug) => `a[href*="/products/${slug}"]`).join(", "),
      ),
    )
    .filter({ visible: true })
    .first();
  await expect(resultLink, `${caseConfig.term} 未出现符合预期的搜索结果`).toBeVisible();

  return resultLink;
}

async function openSearchResultPdp(
  page: Page,
  resultLink: Locator,
  caseConfig: SearchCase,
): Promise<void> {
  await navigateByLocatorHref(page, resultLink, buildExpectedProductUrl(caseConfig), 15000);
  await closeSitePopups(page);
}

async function assertSearchResultPdp(
  page: Page,
  caseConfig: SearchCase,
): Promise<void> {
  const productTitle = await firstVisible(
    [
      page
        .locator(".product_info_new_product_title, .product_info_new_right_title, h1")
        .filter({ hasText: caseConfig.expectedPdpTitle })
        .first(),
      page.locator("main").getByText(caseConfig.expectedPdpTitle).first(),
    ],
    10000,
  );

  const mainHasPdpTitle = await expect
    .poll(
      async () => {
        const text = await page.locator("main").textContent().catch(() => null);
        return caseConfig.expectedPdpTitle.test(text ?? "");
      },
      {
        timeout: 10000,
        message: `${caseConfig.term} PDP 主内容未出现预期标题`,
      },
    )
    .toBeTruthy()
    .then(() => true)
    .catch(() => false);

  expect(
    productTitle !== null || mainHasPdpTitle,
    `${caseConfig.term} PDP 标题未出现`,
  ).toBeTruthy();
}

test.describe("P1_SEARCH - 搜索功能", () => {
  const target = getCurrentTarget();

  for (const searchCase of SEARCH_CASES) {
    test(`搜索商品: ${searchCase.term}`, async ({ page, isMobile }, testInfo) => {
      const diagnostics = setupJourneyDiagnostics(page);
      let resultLink: Locator | null = null;
      const labelSuffix = searchCase.resultSlugs[0] ?? searchCase.term.toLowerCase();

      await installWebVitalsCollector(page);
      await applyDeterministicJourneyHeaders(page);

      try {
        await test.step("打开搜索框并提交搜索", async () => {
          await openSearchResultsPage(page, target.url, searchCase.term, isMobile);
        });

        await test.step("搜索结果真实加载", async () => {
          resultLink = await assertSearchResults(page, searchCase);
          await captureJourneyVitalsCheckpoint(
            page,
            diagnostics,
            `search-results-${labelSuffix}`,
            "P1",
          );
        });

        await test.step("进入搜索结果 PDP", async () => {
          expect(resultLink, `${searchCase.term} 搜索结果链接未准备好`).not.toBeNull();
          await openSearchResultPdp(page, resultLink!, searchCase);
        });

        await test.step("PDP 与搜索意图匹配", async () => {
          await assertSearchResultPdp(page, searchCase);
          await captureJourneyVitalsCheckpoint(page, diagnostics, `pdp-${labelSuffix}`, "P1");
        });
      } finally {
        await test.step("收集关键证据", async () => {
          await attachJourneyEvidence(page, testInfo, diagnostics, "P1");
        });
      }
    });
  }
});
