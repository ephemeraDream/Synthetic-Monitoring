import { Page } from "@playwright/test";

/**
 * 统一关闭营销弹窗
 * 规则：点击 Close / "No, subscribe later" / Escape 多轮尝试
 */
export async function closeJumpPopup(
  page: Page,
  maxAttempts = 5,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // 尝试多种关闭方式
      const closeSelectors = [
        // 通用关闭按钮
        ".cozy-crd__dismiss",
        ".CozyCloseCRModal",
        ".CozyCloseCRModal:has-text('No, please do not redirect me.')",
        ".cozy-crd__decline-button",
      ];

      for (const selector of closeSelectors) {
        try {
          const element = page.locator(selector).first();
          if (await element.isVisible({ timeout: 1000 })) {
            await element.click({ timeout: 2000 });
            await page.waitForTimeout(500); // 等待动画
            continue;
          }
        } catch {
          // 继续尝试下一个选择器
        }
      }

      // 尝试按 Escape 键
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // 检查弹窗是否还存在
      const modalVisible = await page
        .locator(".cozy-crd__modal")
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      if (!modalVisible) {
        return true; // 成功关闭
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
export async function waitAndCloseJumpPopup(
  page: Page,
  timeout = 5000,
): Promise<void> {
  try {
    await page
      .waitForSelector(".cozy-crd__modal", { timeout, state: "visible" })
      .catch(() => {});
    await closeJumpPopup(page);
  } catch {
    // 没有弹窗或已关闭
  }
}

/**
 * 关闭营销弹窗（参考模板使用的函数名）
 */
export async function closeMarketingJumpPopups(page: Page): Promise<void> {
  await closeJumpPopup(page);
}
