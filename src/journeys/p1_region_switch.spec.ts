import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  getAllTargets,
  getCurrentTarget,
  type Region,
  type TargetConfig,
} from "../config/targets";
import { installWebVitalsCollector } from "../utils/vitals";
import {
  applyDeterministicJourneyHeaders,
  attachJourneyEvidence,
  captureJourneyVitalsCheckpoint,
  closeSitePopups,
  firstVisible,
  isTemporaryErrorPage,
  navigateByLocatorHref,
  openMobileMenu,
  openStableStorefrontPage,
  setupJourneyDiagnostics,
} from "../utils/storefrontJourney";

const REGION_LABELS: Record<Region, string> = {
  US: "United States",
  CA: "Canada",
  EU: "Europe",
  UK: "United Kingdom",
  AU: "Australia",
  JP: "Japan",
};

function normalizeHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findDesktopRegionOption(
  page: Page,
  target: TargetConfig,
): Promise<Locator> {
  const targetLabel = REGION_LABELS[target.region];
  const targetHost = normalizeHost(target.url);
  const optionLocators = [
    page
      .locator(`.halo-currency a.dropdown-item[href*="${targetHost}"]`)
      .filter({ hasText: new RegExp(targetLabel, "i") })
      .first(),
    page
      .locator(`a.dropdown-item[href*="${targetHost}"]`)
      .filter({ hasText: new RegExp(targetLabel, "i") })
      .first(),
  ];

  let targetOption = await firstVisible(optionLocators, 4000);

  if (!targetOption) {
    const trigger = await firstVisible(
      [
        page.locator(".halo-top-currency .dropdown-label").first(),
        page.locator(".halo-top-currency .text").first(),
        page.locator(".header-language_currency .halo-top-currency").first(),
      ],
      5000,
    );
    expect(trigger, "桌面端未找到 Regions 触发器").not.toBeNull();

    await trigger!.click({ force: true });
    targetOption = await firstVisible(optionLocators, 8000);
  }

  expect(targetOption, `桌面端未找到 ${targetLabel} 区域选项`).not.toBeNull();
  return targetOption!;
}

async function findMobileRegionOption(
  page: Page,
  target: TargetConfig,
): Promise<Locator> {
  await openMobileMenu(page);

  const targetLabel = REGION_LABELS[target.region];
  const targetHost = normalizeHost(target.url);
  const targetOption = await firstVisible(
    [
      page
        .locator(`.currency-block a.dropdown-item[href*="${targetHost}"]`)
        .filter({ hasText: new RegExp(targetLabel, "i") })
        .first(),
      page
        .locator(`.currency-block [role="button"][href*="${targetHost}"]`)
        .filter({ hasText: new RegExp(targetLabel, "i") })
        .first(),
      page
        .locator(`.halo-sidebar_menu a.dropdown-item[href*="${targetHost}"]`)
        .filter({ hasText: new RegExp(targetLabel, "i") })
        .first(),
      page
        .locator(`a.dropdown-item[href*="${targetHost}"]`)
        .filter({ hasText: new RegExp(targetLabel, "i") })
        .first(),
    ],
    8000,
  );
  expect(targetOption, `移动端未找到 ${targetLabel} 区域选项`).not.toBeNull();

  await targetOption!.scrollIntoViewIfNeeded().catch(() => {});
  return targetOption!;
}

async function switchByRegionOption(
  page: Page,
  targetOption: Locator,
  target: TargetConfig,
): Promise<void> {
  const targetHost = normalizeHost(target.url);

  await navigateByLocatorHref(
    page,
    targetOption,
    (url) => normalizeHost(url.toString()) === targetHost,
    20000,
  );
  await closeSitePopups(page);
}

async function assertRegionLanding(
  page: Page,
  target: TargetConfig,
  isMobile: boolean,
): Promise<void> {
  const targetLabel = REGION_LABELS[target.region];
  const targetHost = normalizeHost(target.url);

  await expect
    .poll(() => normalizeHost(page.url()), {
      timeout: 20000,
      message: `URL 一直没有切到 ${target.region} 站点`,
    })
    .toBe(targetHost);

  expect(await isTemporaryErrorPage(page), `${target.region} 站点落地后出现错误页`).toBeFalsy();
  await expect(page.locator("main")).toBeVisible({ timeout: 10000 });

  if (isMobile) {
    await openMobileMenu(page);

    const mobileRegionIndicator = await firstVisible(
      [
        page
          .locator(".currency-block .current_country_items .current_text")
          .filter({ hasText: new RegExp(targetLabel, "i") })
          .first(),
        page
          .locator(".currency-block .current_country_items")
          .filter({ hasText: new RegExp(targetLabel, "i") })
          .first(),
      ],
      8000,
    );
    const titleHasRegion = new RegExp(
      `${escapeRegExp(target.region)}|${escapeRegExp(targetLabel)}`,
      "i",
    ).test(await page.title().catch(() => ""));

    expect(
      mobileRegionIndicator !== null || titleHasRegion,
      `移动端未显示当前区域为 ${targetLabel}`,
    ).toBeTruthy();
  } else {
    const desktopRegionIndicator = await firstVisible(
      [
        page
          .locator(".halo-top-currency .text")
          .filter({ hasText: new RegExp(targetLabel, "i") })
          .first(),
        page
          .locator(".current_country_items .current_text")
          .filter({ hasText: new RegExp(targetLabel, "i") })
          .first(),
      ],
      8000,
    );
    expect(desktopRegionIndicator, `桌面端未显示当前区域为 ${targetLabel}`).not.toBeNull();
  }

  const headerReady = await firstVisible(
    [
      page.getByRole("navigation").first(),
      page.locator("header nav").first(),
      page.locator(".header__heading-link").first(),
      page.locator('a[href="/"] img[alt*="blacklyte" i]').first(),
      page.locator('header a[href="/"]').first(),
    ],
    8000,
  );
  expect(headerReady, `${target.region} 站点首页核心页头未出现`).not.toBeNull();
}

test.describe("P1_REGION_SWITCH - 区域切换", () => {
  const currentTarget = getCurrentTarget();
  const switchTarget = getAllTargets().find((target) => target.region !== currentTarget.region);

  test(`切换到 ${switchTarget?.region ?? "目标区域"} 站点`, async ({ page, isMobile }, testInfo) => {
    test.skip(!switchTarget, "当前没有可切换的其他区域");
    if (!switchTarget) {
      return;
    }

    const diagnostics = setupJourneyDiagnostics(page);
    let targetOption: Locator | null = null;

    await installWebVitalsCollector(page);
    await applyDeterministicJourneyHeaders(page);

    try {
      await test.step("打开当前区域首页", async () => {
        await openStableStorefrontPage(page, currentTarget.url, undefined, {
          attempts: 2,
        });
        await captureJourneyVitalsCheckpoint(
          page,
          diagnostics,
          `home-${currentTarget.region.toLowerCase()}`,
          "P1",
        );
      });

      await test.step("找到真实区域切换入口", async () => {
        targetOption = isMobile
          ? await findMobileRegionOption(page, switchTarget)
          : await findDesktopRegionOption(page, switchTarget);
      });

      await test.step(`切换到 ${switchTarget.region} 站点`, async () => {
        expect(targetOption, `${switchTarget.region} 区域选项未准备好`).not.toBeNull();
        await switchByRegionOption(page, targetOption!, switchTarget);
      });

      await test.step("目标区域站点正常加载", async () => {
        await assertRegionLanding(page, switchTarget, isMobile);
        await captureJourneyVitalsCheckpoint(
          page,
          diagnostics,
          `home-${switchTarget.region.toLowerCase()}`,
          "P1",
        );
      });
    } finally {
      await test.step("收集关键证据", async () => {
        await attachJourneyEvidence(page, testInfo, diagnostics, "P1");
      });
    }
  });
});
