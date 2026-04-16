import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { VITALS_THRESHOLDS } from "../config/vitals_thresholds";
import { attachHAR, buildHAR } from "./har";
import {
  startNetworkCapture,
  type NetworkCaptureEntry,
  type NetworkSummary,
} from "./network";
import { waitAndClosePopup } from "./popup";
import { waitAndCloseJumpPopup } from "./jumpPopup";
import {
  finalizeWebVitals,
  snapshotWebVitals,
  validateVitals,
  type WebVitalsSnapshot,
} from "./vitals";

export const ATHENA_PRO_TITLE = "Athena Pro Gaming Chair";
export const ATHENA_PRO_SLUG = "blacklyte-athena-pro-gaming-chair";
export const DETERMINISTIC_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
const TEMPORARY_ERROR_PAGE_PATTERNS = [
  /something went wrong/i,
  /there was a problem loading this website/i,
  /try refreshing the page/i,
  /if the site still doesn't load, please try again in a few minutes/i,
];

export type JourneyPriority = keyof typeof VITALS_THRESHOLDS;

export type JourneyDiagnostics = {
  disposeNetworkCapture: () => void;
  getNetworkEntries: () => NetworkCaptureEntry[];
  getNetworkSummary: () => NetworkSummary;
  consoleLogs: Array<{ type: string; text: string }>;
  consoleErrors: string[];
  failedRequests: Array<{ url: string; failure: string }>;
  pageCrashed: boolean;
  vitalsSnapshots: WebVitalsSnapshot[];
};

export type UrlWaitMatcher = RegExp | ((url: URL) => boolean);

export function setupJourneyDiagnostics(page: Page): JourneyDiagnostics {
  const consoleLogs: Array<{ type: string; text: string }> = [];
  const consoleErrors: string[] = [];
  const failedRequests: Array<{ url: string; failure: string }> = [];
  const networkCapture = startNetworkCapture(page);
  let pageCrashed = false;

  page.on("console", (msg) => {
    const entry = { type: msg.type(), text: msg.text() };
    consoleLogs.push(entry);

    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(`Page Error: ${error.message}`);
  });

  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText || "Unknown failure",
    });
  });

  page.on("crash", () => {
    pageCrashed = true;
    consoleErrors.push("Page crashed");
  });

  return {
    disposeNetworkCapture: networkCapture.dispose,
    getNetworkEntries: networkCapture.getEntries,
    getNetworkSummary: networkCapture.getSummary,
    consoleLogs,
    consoleErrors,
    failedRequests,
    get pageCrashed() {
      return pageCrashed;
    },
    vitalsSnapshots: [],
  };
}

export async function applyDeterministicJourneyHeaders(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({
    "Accept-Language": DETERMINISTIC_ACCEPT_LANGUAGE,
  });
}

export async function closeSitePopups(
  page: Page,
  timeout = 1500,
): Promise<void> {
  await waitAndCloseJumpPopup(page, timeout);
  await waitAndClosePopup(page, timeout);
}

async function dismissOverlays(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await closeSitePopups(page, 800);
}

export async function firstVisible(
  locators: Locator[],
  timeout = 2000,
): Promise<Locator | null> {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    const limit = Math.min(Math.max(count, 1), 5);

    for (let index = 0; index < limit; index++) {
      const candidate = count > 0 ? locator.nth(index) : locator;
      const visible = await candidate.isVisible({ timeout }).catch(() => false);

      if (visible) {
        return candidate;
      }
    }
  }

  return null;
}

function extractCount(text: string | null): number | null {
  if (!text) {
    return null;
  }

  const match = text.replace(/\s+/g, " ").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export async function readCartCount(page: Page): Promise<number | null> {
  const cartTexts = await page
    .locator('a[href="/cart"]')
    .allTextContents()
    .catch(() => []);

  for (const text of cartTexts) {
    const count = extractCount(text);
    if (count !== null) {
      return count;
    }
  }

  const bubbleTexts = await page
    .locator(".cart-count-bubble")
    .allTextContents()
    .catch(() => []);

  for (const text of bubbleTexts) {
    const count = extractCount(text);
    if (count !== null) {
      return count;
    }
  }

  return null;
}

export async function waitForVisible(
  locator: Locator,
  timeout = 5000,
): Promise<boolean> {
  return locator
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

export async function waitForCartIncrease(
  page: Page,
  previousCount: number | null,
  timeout = 8000,
): Promise<boolean> {
  if (previousCount === null) {
    return false;
  }

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const currentCount = await readCartCount(page);
    if (currentCount !== null && currentCount > previousCount) {
      return true;
    }

    await page.waitForTimeout(250);
  }

  return false;
}

export function buildStorefrontUrl(baseUrl: string, pathname: string): string {
  return new URL(pathname, baseUrl).toString();
}

async function gotoStorefrontPageOnce(
  page: Page,
  url: string,
  timeout = 45000,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await closeSitePopups(page);
}

export async function openStorefrontPage(
  page: Page,
  url: string,
  timeout = 45000,
): Promise<void> {
  await openStableStorefrontPage(page, url, undefined, {
    navigationTimeout: timeout,
  });
}

export async function isTemporaryErrorPage(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";
  const pageText = `${title}\n${bodyText}`;

  return TEMPORARY_ERROR_PAGE_PATTERNS.some((pattern) => pattern.test(pageText));
}

async function recoverTemporaryErrorPage(
  page: Page,
  fallbackUrl?: string,
  timeout = 15000,
): Promise<boolean> {
  if (!(await isTemporaryErrorPage(page))) {
    return true;
  }

  const refreshButton = await firstVisible(
    [
      page.getByRole("button", { name: /refresh page/i }).first(),
      page.locator("button").filter({ hasText: /refresh page/i }).first(),
      page.locator("button, a").filter({ hasText: /^refresh$/i }).first(),
    ],
    1500,
  );

  const settleAfterRecoveryAction = async (): Promise<boolean> => {
    await page.waitForTimeout(500);
    await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => {});
    await closeSitePopups(page, 800).catch(() => {});
    return !(await isTemporaryErrorPage(page));
  };

  if (refreshButton) {
    await refreshButton.click({ force: true }).catch(() => {});
    if (await settleAfterRecoveryAction()) {
      return true;
    }
  }

  const reloaded = await page.reload({ waitUntil: "domcontentloaded", timeout })
    .then(() => true)
    .catch(() => false);
  if (reloaded) {
    await closeSitePopups(page, 800).catch(() => {});
    if (!(await isTemporaryErrorPage(page))) {
      return true;
    }
  }

  if (fallbackUrl) {
    const reopened = await gotoStorefrontPageOnce(page, fallbackUrl, timeout)
      .then(() => true)
      .catch(() => false);
    if (reopened && !(await isTemporaryErrorPage(page))) {
      return true;
    }
  }

  return !(await isTemporaryErrorPage(page));
}

export async function openStableStorefrontPage(
  page: Page,
  url: string,
  readyLocators?: Locator[],
  options?: {
    attempts?: number;
    navigationTimeout?: number;
    readyMessage?: string;
    readyTimeout?: number;
  },
): Promise<void> {
  const attempts = options?.attempts ?? 2;
  const navigationTimeout = options?.navigationTimeout ?? 45000;
  const readyTimeout = options?.readyTimeout ?? 5000;
  const readyMessage = options?.readyMessage ?? "页面核心结构未出现";

  for (let attempt = 0; attempt < attempts; attempt++) {
    const opened = await gotoStorefrontPageOnce(page, url, navigationTimeout)
      .then(() => true)
      .catch(() => false);

    if (!opened) {
      await page.waitForTimeout(1000);
      continue;
    }

    if (await isTemporaryErrorPage(page)) {
      const recovered = await recoverTemporaryErrorPage(page, url, navigationTimeout);
      if (!recovered) {
        await page.waitForTimeout(1000);
        continue;
      }
    }

    if (!readyLocators?.length) {
      await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
      return;
    }

    const ready = await firstVisible(readyLocators, readyTimeout);
    if (ready) {
      return;
    }
  }

  expect(await isTemporaryErrorPage(page), "页面仍然停留在站点错误页").toBeFalsy();

  if (readyLocators?.length) {
    const ready = await firstVisible(readyLocators, readyTimeout);
    expect(ready, readyMessage).not.toBeNull();
  } else {
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  }
}

export async function navigateByLocatorHref(
  page: Page,
  link: Locator,
  waitFor: UrlWaitMatcher,
  timeout = 15000,
): Promise<void> {
  const href = await link.getAttribute("href");
  expect(href, "链接缺少 href").toBeTruthy();
  const resolvedUrl = new URL(href!, page.url()).toString();

  const waitForTarget = () =>
    typeof waitFor === "function"
      ? page.waitForURL(waitFor, {
          timeout,
          waitUntil: "domcontentloaded",
        })
      : page.waitForURL(waitFor, {
          timeout,
          waitUntil: "domcontentloaded",
        });

  const navigateByResolvedUrl = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const opened = await openStableStorefrontPage(page, resolvedUrl, undefined, {
        attempts: 3,
        navigationTimeout: timeout,
        readyTimeout: 8000,
      })
        .then(() => true)
        .catch(() => false);

      if (!opened) {
        await page.waitForTimeout(1000);
        continue;
      }

      const matched = await waitForTarget()
        .then(() => true)
        .catch(() => false);

      if (!matched) {
        await page.waitForTimeout(1000);
        continue;
      }

      if (await isTemporaryErrorPage(page)) {
        await page.waitForTimeout(1000);
        continue;
      }

      return true;
    }

    return false;
  };

  let navigated = await Promise.all([
    waitForTarget()
      .then(() => true)
      .catch(() => false),
    link.click({ force: true }).catch(() => {}),
  ]).then(([didNavigate]) => didNavigate);

  if (navigated) {
    await closeSitePopups(page, 800);
    if (await isTemporaryErrorPage(page)) {
      navigated = await recoverTemporaryErrorPage(page, resolvedUrl, timeout);
    }
  }

  if (!navigated) {
    navigated = await navigateByResolvedUrl();
  }

  expect(navigated, "未能通过链接完成目标导航").toBeTruthy();
}

export async function openMobileMenu(page: Page): Promise<void> {
  const menuButtonLocators = [
    page.getByRole("button", { name: /menu/i }),
    page.locator('button[aria-label*="menu" i]'),
    page.locator('summary[aria-label*="menu" i]'),
    page.locator(".mobileMenu-toggle"),
    page.locator(".header-mobile__item--menu button"),
    page.locator(".header-mobile__item--menu"),
  ];
  const menuReadyLocators = [
    page.getByText(/^Menu$/).first(),
    page.getByRole("link", { name: /Sign In/i }).first(),
    page.locator(".halo-sidebar_menu, #navigation-mobile").first(),
  ];

  await expect(page.locator("main")).toBeVisible({ timeout: 10000 }).catch(() => {});

  let menuButton = await firstVisible(menuButtonLocators, 3000);
  if (!menuButton) {
    await closeSitePopups(page, 800);
    await page.waitForTimeout(500);
    menuButton = await firstVisible(menuButtonLocators, 5000);
  }

  expect(menuButton, "移动端未找到 menu 按钮").not.toBeNull();

  const tryOpenMenu = async (): Promise<boolean> => {
    await menuButton!.scrollIntoViewIfNeeded().catch(() => {});
    await menuButton!.click({ force: true }).catch(() => {});
    const menuReady = await firstVisible(menuReadyLocators, 5000);
    return menuReady !== null;
  };

  let opened = await tryOpenMenu();
  if (!opened) {
    await closeSitePopups(page, 800);
    await page.waitForTimeout(500);
    menuButton = await firstVisible(menuButtonLocators, 3000) ?? menuButton;
    opened = await tryOpenMenu();
  }

  expect(opened, "移动端菜单未成功展开").toBeTruthy();
}

export async function closeMobileMenu(page: Page): Promise<void> {
  const closeButton = await firstVisible(
    [
      page.locator(".halo-sidebar-close"),
      page.getByRole("button", { name: /Close/i }),
      page.getByRole("link", { name: /Close/i }),
    ],
    3000,
  );

  if (!closeButton) {
    return;
  }

  await closeButton.click({ force: true }).catch(() => {});
}

export async function openSearchInput(
  page: Page,
  isMobile: boolean,
): Promise<Locator> {
  const findVisibleSearchInput = async (timeout: number) =>
    firstVisible(
      isMobile
        ? [
            page.locator("#Search-In-Modal-Sidebar"),
            page.locator('#search-form-mobile input[type="search"]'),
            page.locator('.halo-sidebar input[name="q"][type="search"]'),
          ]
        : [
            page.locator("#Search-In-Modal-Menu-Plain"),
            page.locator('.header__search-full input[name="q"][type="search"]'),
            page.locator('details-modal input[name="q"][type="search"]'),
            page.locator('input[name="q"][type="search"]'),
          ],
      timeout,
    );

  let input = await findVisibleSearchInput(1000);

  if (!input) {
    if (isMobile) {
      const mobileToggle = await firstVisible(
        [
          page.getByLabel(/search/i),
          page.locator(".header-mobile__item--search .header__search"),
          page.locator(".header-mobile__item--search"),
          page.locator(".header-mobile__item--search .header__search .header__icon"),
          page.locator(".header-mobile__item--search .header__search"),
          page.locator(".header__search-full"),
          page.locator('summary[aria-label="Search"]'),
        ],
        3000,
      );
      expect(mobileToggle, "未找到移动端搜索入口").not.toBeNull();

      await mobileToggle!.click({ force: true });

      const mobileSearchForm = page.locator("#search-form-mobile");
      const formVisible = await Promise.all([
        mobileSearchForm.isVisible({ timeout: 3000 }).catch(() => false),
        findVisibleSearchInput(3000).then((candidate) => candidate !== null),
        page
          .getByRole("dialog", { name: /search/i })
          .isVisible({ timeout: 3000 })
          .catch(() => false),
      ]).then((signals) => signals.some(Boolean));

      if (!formVisible) {
        await closeSitePopups(page, 800);
        await mobileToggle!.click({ force: true }).catch(() => {});
      }
    } else {
      const toggle = await firstVisible(
        [
          page.locator('summary[aria-label="Search"]'),
          page.locator(".header__search-full"),
        ],
        3000,
      );

      expect(toggle, "未找到可用的搜索入口").not.toBeNull();
      await toggle!.click({ force: true });
    }

    input = await findVisibleSearchInput(5000);
  }

  expect(input, "搜索输入框未出现").not.toBeNull();
  await expect(input!).toBeVisible({ timeout: 10000 });
  return input!;
}

export async function submitSearch(
  page: Page,
  input: Locator,
  keyword: string,
  isMobile: boolean,
): Promise<void> {
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.fill(keyword);

  const form = input.locator("xpath=ancestor::form[1]");
  const searchButton = await firstVisible(
    [
      form.locator('button[aria-label="Search"]'),
      form.getByRole("button", { name: /search/i }),
      form.locator('button[type="submit"]'),
    ],
    2000,
  );

  const submitByButton = async () => {
    if (searchButton) {
      await searchButton.scrollIntoViewIfNeeded().catch(() => {});
      await searchButton.click({ force: true });
      return;
    }

    const pressed = await input
      .press("Enter")
      .then(() => true)
      .catch(() => false);

    if (!pressed) {
      await input.evaluate((node) => {
        const inputElement = node as HTMLInputElement;
        inputElement.form?.requestSubmit();
      });
    }
  };

  const submitViaInputForm = async (): Promise<void> => {
    const activeInput = await firstVisible(
      [
        input,
        page.locator('input[name="q"][type="search"]'),
        page.locator('input[type="search"]'),
      ],
      3000,
    );

    if (!activeInput) {
      await page.keyboard.press("Enter").catch(() => {});
      return;
    }

    await activeInput.evaluate((node) => {
      const inputElement = node as HTMLInputElement;
      const formElement = inputElement.form;

      if (formElement) {
        formElement.requestSubmit();
        return;
      }

      inputElement.focus();
      inputElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    });
  };

  let navigated = await Promise.all([
    page
      .waitForURL(/\/search\?/i, {
          timeout: 15000,
        waitUntil: "domcontentloaded",
      })
      .then(() => true)
      .catch(() => false),
    submitByButton(),
  ]).then(([didNavigate]) => didNavigate);

  if (!navigated) {
    navigated = await Promise.all([
      page
        .waitForURL(/\/search\?/i, {
          timeout: 15000,
          waitUntil: "domcontentloaded",
        })
        .then(() => true)
        .catch(() => false),
      submitViaInputForm(),
    ]).then(([didNavigate]) => didNavigate);
  }

  if (!navigated) {
    const searchUrl = new URL(`/search?q=${encodeURIComponent(keyword)}`, page.url()).toString();

    const opened = await openStableStorefrontPage(page, searchUrl, undefined, {
      attempts: 2,
      navigationTimeout: 15000,
      readyMessage: "搜索结果页未稳定打开",
      readyTimeout: 8000,
    })
      .then(() => true)
      .catch(() => false);

    if (opened) {
      navigated = /\/search(?:\?|$)/i.test(page.url());
    }
  }

  expect(navigated, "搜索表单未跳转到结果页").toBeTruthy();
  await dismissOverlays(page);
}

async function findAddToCartButton(page: Page, timeout = 10000): Promise<Locator | null> {
  return firstVisible(
    [
      page
        .locator(".product_info_new_right_buybox_btns_btn")
        .filter({ hasText: /^add to cart$/i })
        .first(),
      page
        .locator(".product_infor_simplicity_right_buybox_btns_btn")
        .filter({ hasText: /^add to cart$/i })
        .first(),
      page.getByRole("button", { name: /add to cart/i }).first(),
    ],
    timeout,
  );
}

async function findCartProduct(page: Page, timeout = 8000): Promise<Locator | null> {
  return firstVisible(
    [
      page.locator(`main a[href*="${ATHENA_PRO_SLUG}"]`).first(),
      page.locator(`#halo-cart-sidebar a[href*="${ATHENA_PRO_SLUG}"]`).first(),
      page
        .locator("main a[href*='/products/']")
        .filter({ hasText: /Athena Pro/i })
        .first(),
      page
        .locator("#halo-cart-sidebar a[href*='/products/']")
        .filter({ hasText: /Athena Pro/i })
        .first(),
      page.locator(".cart-item__name").filter({ hasText: /Athena Pro/i }).first(),
      page.locator("[data-cart-item-title]").filter({ hasText: /Athena Pro/i }).first(),
      page.locator(".cart-item").first(),
      page.locator("[data-cart-item]").first(),
    ],
    timeout,
  );
}

async function hasEmptyCartState(page: Page, timeout = 2000): Promise<boolean> {
  const emptyState = await firstVisible(
    [
      page.getByText(/your shopping cart is empty/i).first(),
      page.locator("#halo-cart-sidebar").getByText(/your shopping cart is empty/i).first(),
    ],
    timeout,
  );

  return emptyState !== null;
}

export async function openProductPdp(
  page: Page,
  baseUrl: string,
  slug: string,
  title: string,
): Promise<void> {
  const productUrl = buildStorefrontUrl(baseUrl, `/products/${slug}`);
  const pdpReadyLocators = [
    page.locator("main").getByText(title, { exact: true }).first(),
    page
      .locator(".product_info_new_product_title, .product_info_new_right_title, h1")
      .filter({ hasText: title })
      .first(),
    page
      .locator(".product_info_new_right_buybox_btns_btn")
      .filter({ hasText: /^add to cart$/i })
      .first(),
    page
      .locator(".product_infor_simplicity_right_buybox_btns_btn")
      .filter({ hasText: /^add to cart$/i })
      .first(),
    page.getByRole("button", { name: /add to cart/i }).first(),
  ];

  await openStableStorefrontPage(page, productUrl, pdpReadyLocators, {
    attempts: 3,
    readyMessage: `PDP 一直没有出现 ${title} 标题或加购入口`,
    readyTimeout: 8000,
  });
  await dismissOverlays(page);

  await page
    .waitForURL(new RegExp(`/products/${slug}(?:[/?#]|$)`, "i"), {
      timeout: 10000,
      waitUntil: "domcontentloaded",
    })
    .catch(() => {});

  const productTitle = await firstVisible(
    [
      page.locator("main").getByText(title, { exact: true }).first(),
      page
        .locator(".product_info_new_product_title, .product_info_new_right_title, h1")
        .filter({ hasText: title })
        .first(),
    ],
    6000,
  );

  const mainHasTitle = await expect
    .poll(
      async () => {
        const text = await page.locator("main").textContent().catch(() => null);
        return text?.includes(title) ?? false;
      },
      {
        timeout: 10000,
        message: `main 区域一直没出现 ${title} 文本`,
      },
    )
    .toBeTruthy()
    .then(() => true)
    .catch(() => false);

  const addToCartButton = await findAddToCartButton(page, 6000);
  const addToCartVisible = addToCartButton
    ? await addToCartButton.isVisible({ timeout: 1000 }).catch(() => false)
    : false;

  expect(
    productTitle !== null || mainHasTitle || addToCartVisible,
    `未进入 ${title} 的 PDP`,
  ).toBeTruthy();
}

export async function addCurrentProductToCart(page: Page): Promise<void> {
  await dismissOverlays(page);

  const addToCartButton = await findAddToCartButton(page, 10000);
  expect(addToCartButton, "PDP 加购按钮未出现").not.toBeNull();

  const beforeCartCount = await readCartCount(page);

  await addToCartButton!.scrollIntoViewIfNeeded().catch(() => {});
  await addToCartButton!.click();

  const cartSidebar = page.locator("#halo-cart-sidebar");
  const viewCartButton = page
    .locator('a.button-view-cart[href^="/cart"], a.button-view-cart')
    .first();
  const drawerCheckoutButton = page
    .locator(
      '#cart-sidebar-checkout, #halo-cart-sidebar [aria-label="Checkout"], #halo-cart-sidebar .button.button-1',
    )
    .first();

  const [
    cartSidebarVisible,
    viewCartVisible,
    drawerCheckoutVisible,
    navigatedToCart,
    cartIncreased,
  ] = await Promise.all([
    waitForVisible(cartSidebar, 8000),
    waitForVisible(viewCartButton, 8000),
    waitForVisible(drawerCheckoutButton, 8000),
    page
      .waitForURL(/\/cart(?:\?|$)/i, {
        timeout: 8000,
        waitUntil: "domcontentloaded",
      })
      .then(() => true)
      .catch(() => false),
    waitForCartIncrease(page, beforeCartCount, 8000),
  ]);

  const cartProduct = await findCartProduct(page, 5000);
  const emptyCartVisible = await hasEmptyCartState(page, 2000);

  expect(
    cartProduct !== null ||
      cartIncreased ||
      (!emptyCartVisible &&
        (cartSidebarVisible || viewCartVisible || drawerCheckoutVisible || navigatedToCart)),
    "加购后没有拿到可靠成功信号，购物车里也没看到商品",
  ).toBeTruthy();
}

export async function goToCart(page: Page, isMobile: boolean): Promise<void> {
  await dismissOverlays(page);

  const cartEntry = await firstVisible(
    [
      page.locator('a.button-view-cart[href^="/cart"]'),
      page.locator("a.button-view-cart"),
      page.getByRole("link", { name: /Cart .*item/i }),
      page.locator('a[href="/cart"].cart-icon-bubble'),
      page.locator('a[href="/cart"]'),
    ],
    8000,
  );
  expect(cartEntry, "未找到进入购物车的入口").not.toBeNull();

  await cartEntry!.click({ force: isMobile });
  await page.waitForURL(/\/cart(?:\?|$)/i, {
    timeout: 15000,
    waitUntil: "domcontentloaded",
  });
  await dismissOverlays(page);

  const cartHeading = await firstVisible(
    [
      page.getByRole("heading", { name: /shopping cart|your cart/i }).first(),
      page.locator("h1, h2").filter({ hasText: /shopping cart|your cart/i }).first(),
    ],
    10000,
  );
  expect(cartHeading, "购物车标题未出现").not.toBeNull();

  const emptyCartVisible = await hasEmptyCartState(page, 2000);
  expect(emptyCartVisible, "购物车仍然是空的").toBeFalsy();

  const cartItem = await firstVisible(
    [
      page.locator(`main a[href*="${ATHENA_PRO_SLUG}"]`).first(),
      page
        .locator("main a[href*='/products/']")
        .filter({ hasText: /Athena Pro/i })
        .first(),
      page.locator(".cart-item").first(),
      page.locator(".line-item").first(),
      page.locator(".cart-item__name").first(),
      page.locator("[data-cart-item]").first(),
    ],
    10000,
  );
  expect(cartItem, "购物车未出现商品行").not.toBeNull();
}

export async function goToCheckout(page: Page): Promise<void> {
  await dismissOverlays(page);

  const checkoutButton = await firstVisible(
    [
      page.locator("button.button-checkout").filter({ hasText: /checkout/i }).first(),
      page.locator('a.button-checkout[href*="/checkout"]').first(),
      page.locator('a[href="/checkout"]').first(),
    ],
    10000,
  );
  expect(checkoutButton, "购物车页未找到 checkout 按钮").not.toBeNull();

  await expect(checkoutButton!).toBeEnabled({ timeout: 5000 });
  await checkoutButton!.click();

  await page.waitForURL(/\/checkouts?\/|\/checkout/i, {
    timeout: 20000,
    waitUntil: "domcontentloaded",
  });

  const checkoutHeading = await firstVisible(
    [
      page.getByRole("heading", { name: /checkout/i }).first(),
      page.locator("h1, h2, legend").filter({ hasText: /contact|delivery|shipping|payment/i }).first(),
    ],
    10000,
  );
  const emailInputVisible = await page
    .locator('input[name="email"], #email')
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  const headingVisible = checkoutHeading
    ? await checkoutHeading.isVisible({ timeout: 1000 }).catch(() => false)
    : false;

  expect(
    emailInputVisible || headingVisible,
    "checkout 页面未出现邮箱字段或核心标题",
  ).toBeTruthy();
}

function toAttachmentSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "snapshot";
}

function warnVitalsThresholds(
  label: string,
  snapshot: WebVitalsSnapshot,
  priority: JourneyPriority,
): void {
  const result = validateVitals(snapshot.summary, VITALS_THRESHOLDS[priority]);

  for (const failure of result.failures) {
    console.warn(`[${label}] ${failure}`);
  }
}

export async function captureJourneyVitalsCheckpoint(
  page: Page,
  diagnostics: JourneyDiagnostics,
  label: string,
  priority: JourneyPriority = "P0",
): Promise<WebVitalsSnapshot> {
  const snapshot = await snapshotWebVitals(page, label);
  diagnostics.vitalsSnapshots.push(snapshot);
  warnVitalsThresholds(label, snapshot, priority);
  return snapshot;
}

export async function attachJourneyEvidence(
  page: Page,
  testInfo: TestInfo,
  diagnostics: JourneyDiagnostics,
  priority: JourneyPriority = "P0",
): Promise<void> {
  const shouldAttachExtendedEvidence = testInfo.status !== testInfo.expectedStatus;
  const shouldAttachConsoleLogs =
    shouldAttachExtendedEvidence || diagnostics.consoleErrors.length > 0;

  try {
    await testInfo.attach("network-summary", {
      body: JSON.stringify(diagnostics.getNetworkSummary(), null, 2),
      contentType: "application/json",
    });

    if (shouldAttachExtendedEvidence) {
      const url = page.isClosed() ? "" : page.url();
      const title =
        page.isClosed()
          ? ""
          : await page.title().catch(() => url);
      const har = buildHAR(diagnostics.getNetworkEntries(), {
        startedDateTime: new Date().toISOString(),
        title,
        url,
      });
      await attachHAR(har, testInfo);
    }

    if (shouldAttachConsoleLogs && diagnostics.consoleLogs.length > 0) {
      await testInfo.attach("console-logs", {
        body: JSON.stringify(diagnostics.consoleLogs, null, 2),
        contentType: "application/json",
      });
    }

    if (diagnostics.consoleErrors.length > 0) {
      await testInfo.attach("console-errors", {
        body: diagnostics.consoleErrors.join("\n\n"),
        contentType: "text/plain",
      });
    }

    if (diagnostics.failedRequests.length > 0) {
      await testInfo.attach("failed-requests", {
        body: JSON.stringify(diagnostics.failedRequests, null, 2),
        contentType: "application/json",
      });
    }

    if (!page.isClosed()) {
      try {
        if (diagnostics.vitalsSnapshots.length > 0) {
          for (const snapshot of diagnostics.vitalsSnapshots) {
            await testInfo.attach(`web-vitals-${toAttachmentSlug(snapshot.label)}`, {
              body: JSON.stringify(snapshot, null, 2),
              contentType: "application/json",
            });
          }

          await testInfo.attach("web-vitals-checkpoints", {
            body: JSON.stringify(diagnostics.vitalsSnapshots, null, 2),
            contentType: "application/json",
          });
        }

        if (!diagnostics.pageCrashed) {
          const vitals = await finalizeWebVitals(page, "final-current-page");
          await testInfo.attach("web-vitals", {
            body: JSON.stringify(vitals, null, 2),
            contentType: "application/json",
          });
          warnVitalsThresholds("final-current-page", vitals, priority);
        } else {
          console.warn("页面已 crash，跳过最终 Web Vitals 采集");
        }
      } catch (error) {
        console.warn("无法读取 Web Vitals:", error);
      }

      if (shouldAttachExtendedEvidence && !diagnostics.pageCrashed) {
        try {
          const takeScreenshot = (fullPage: boolean, timeout: number) =>
            page.screenshot({
              fullPage,
              timeout,
              animations: "disabled",
              caret: "hide",
            });

          const screenshot = await takeScreenshot(true, 15000).catch(async (error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("32767 pixels")) {
              console.warn("全页截图过长，回退为视口截图");
              return takeScreenshot(false, 15000);
            }

            if (message.includes("Timeout")) {
              console.warn("全页截图超时，回退为视口截图");
              return takeScreenshot(false, 20000);
            }

            throw error;
          });
          await testInfo.attach("final-screenshot", {
            body: screenshot,
            contentType: "image/png",
          });
        } catch (error) {
          console.warn("无法截取页面截图:", error);
        }

        try {
          const html = await page.content();
          await testInfo.attach("page-html", {
            body: html,
            contentType: "text/html",
          });
        } catch (error) {
          console.warn("无法获取页面 HTML:", error);
        }
      }
    }
  } finally {
    diagnostics.disposeNetworkCapture();
  }
}
