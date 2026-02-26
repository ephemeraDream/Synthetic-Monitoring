import { test, expect } from '@playwright/test';
import { getCurrentTarget } from '../config/targets';
import { closePopup } from '../utils/popup';
import { attachNetworkSummary } from '../utils/network';
import { injectVitalsScript, getWebVitals, validateVitals } from '../utils/vitals';
import { getThresholds } from '../config/vitals_thresholds';
import { waitRandom } from '../utils/random';

/**
 * 旅程模板
 * 
 * 维护规范（强制）：
 * 1. Journey 必须调用 popup close
 * 2. 必须 attach network-summary
 * 3. 必须有"最低成功断言"
 * 4. selector 优先级：getByRole > text > url > aria > css
 * 5. 避免依赖价格/库存/促销文案（改版误报来源）
 */
test.describe('JOURNEY_NAME - 旅程描述', () => {
  const target = getCurrentTarget();

  test.beforeEach(async ({ page }) => {
    // 注入 Web Vitals 采集
    await injectVitalsScript(page);

    // 收集 console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // 添加随机 jitter
    await waitRandom(3000);

    // 导航到目标页面
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });

    // 关闭弹窗（必须）
    await closePopup(page);
  });

  test('核心功能验证', async ({ page }) => {
    // TODO: 实现具体的测试步骤

    // 示例步骤：
    // 1. 导航到特定页面
    // await page.goto(`${target.url}/path`, { waitUntil: 'domcontentloaded' });

    // 2. 执行操作
    // const button = page.getByRole('button', { name: /text/i });
    // await button.click();

    // 3. 验证结果（最低成功断言）
    // await expect(page.locator('selector')).toBeVisible();

    // 4. 收集网络摘要（必须）
    await attachNetworkSummary(page, test);

    // 5. 验证 Web Vitals（可选）
    // const vitals = await getWebVitals(page);
    // const validation = validateVitals(vitals, getThresholds('P0'));
    // if (!validation.passed) {
    //   console.warn('Web Vitals 未达标:', validation.failures);
    // }
  });
});

