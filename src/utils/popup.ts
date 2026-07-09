import { type Locator, type Page } from "@playwright/test";

const CLOSE_ACTION_SELECTORS = [
  // Omnisend / Soundest subscription flyout.
  '#omnisend-forms-container [id$="-close-action"]',
  '#omnisend-forms-container [id$="-teaser-close-btn"]',
  '#omnisend-forms-wrapper [id$="-close-action"]',
  '#omnisend-forms-wrapper [id$="-teaser-close-btn"]',
  '[class*="omnisend-form-"][class*="close" i]',
  '[class*="soundest-form-"][class*="close" i]',
  // Yotpo / SMSBump and generic close buttons.
  'button[aria-label*="close" i]',
  '[aria-label*="close" i][role="button"]',
  '[data-testid*="close" i]',
  ".close",
  ".modal-close",
  'button:has-text("Close")',
  'button:has-text("×")',
  'button:has-text("✕")',
  'button:has-text("No, subscribe later")',
  'button:has-text("No thanks")',
  'button:has-text("Not now")',
  ".modal-backdrop",
  ".overlay",
];

const CLOSE_TEXT_PATTERNS = [
  /^No,\s*subscribe later$/i,
  /^No thanks$/i,
  /^Not now$/i,
  /^Maybe later$/i,
];

const POPUP_VISIBLE_SELECTORS = [
  ".yotpo-smsbump-modal__backdrop[role=\"document\"]",
  "#omnisend-forms-container [id$=\"-close-action\"]",
  "#omnisend-forms-container [id$=\"-teaser-close-btn\"]",
  "#omnisend-forms-wrapper [id$=\"-close-action\"]",
  "#omnisend-forms-wrapper [id$=\"-teaser-close-btn\"]",
  ".modal",
  '[role="dialog"]',
  ".popup",
  ".overlay",
];

const POPUP_WAIT_SELECTOR = POPUP_VISIBLE_SELECTORS.join(", ");

async function firstVisible(
  locator: Locator,
  timeout = 250,
): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0);

  if (count === 0) {
    return null;
  }

  const limit = Math.min(count, 8);

  for (let index = 0; index < limit; index++) {
    const candidate = locator.nth(index);
    const visible = await candidate
      .isVisible({ timeout })
      .catch(() => false);

    if (visible) {
      return candidate;
    }
  }

  return null;
}

async function clickFirstVisible(locator: Locator): Promise<boolean> {
  const element = await firstVisible(locator);

  if (!element) {
    return false;
  }

  await element.click({ timeout: 2000 });
  return true;
}

async function clickCloseText(page: Page): Promise<boolean> {
  const roots = [
    page.locator("#omnisend-forms-container"),
    page.locator("#omnisend-forms-wrapper"),
    page.locator(".yotpo-smsbump-modal__backdrop"),
    page.locator('[role="dialog"]'),
    page.locator(".modal"),
    page.locator(".popup"),
  ];

  for (const pattern of CLOSE_TEXT_PATTERNS) {
    for (const root of roots) {
      const element = await firstVisible(root.getByText(pattern));

      if (element) {
        await element.click({ timeout: 2000 });
        return true;
      }
    }
  }

  return false;
}

async function isMarketingPopupVisible(page: Page): Promise<boolean> {
  for (const selector of POPUP_VISIBLE_SELECTORS) {
    if (await firstVisible(page.locator(selector))) {
      return true;
    }
  }

  for (const pattern of CLOSE_TEXT_PATTERNS) {
    const element = await firstVisible(
      page.locator("#omnisend-forms-container").getByText(pattern),
    );

    if (element) {
      return true;
    }
  }

  return false;
}

/**
 * 统一关闭营销弹窗
 * 规则：点击 Close / "No, subscribe later" / Escape 多轮尝试
 */
export async function closePopup(
  page: Page,
  maxAttempts = 5,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let clickedCloseAction = false;

      for (const selector of CLOSE_ACTION_SELECTORS) {
        try {
          if (await clickFirstVisible(page.locator(selector))) {
            clickedCloseAction = true;
            break;
          }
        } catch {
          // 继续尝试下一个选择器
        }
      }

      if (!clickedCloseAction) {
        clickedCloseAction = await clickCloseText(page).catch(() => false);
      }

      if (clickedCloseAction) {
        await page.waitForTimeout(500); // 等待动画
      }

      // 检查弹窗是否还存在
      if (!(await isMarketingPopupVisible(page))) {
        return true; // 成功关闭
      }

      if (!clickedCloseAction) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    } catch (error) {
      // 继续尝试
    }

    await page.waitForTimeout(1000);
  }

  return false; // 未能完全关闭，但不阻塞测试
}

/**
 * 等待并关闭弹窗（带超时）
 */
export async function waitAndClosePopup(
  page: Page,
  timeout = 5000,
): Promise<void> {
  try {
    await page
      .waitForSelector(POPUP_WAIT_SELECTOR, { timeout, state: "visible" })
      .catch(() => {});
    await closePopup(page);
  } catch {
    // 没有弹窗或已关闭
  }
}

/**
 * 关闭营销弹窗（参考模板使用的函数名）
 */
export async function closeMarketingPopups(page: Page): Promise<void> {
  await closePopup(page);
}
