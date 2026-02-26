import { Page } from '@playwright/test';
import { VitalsThresholds } from '../config/vitals_thresholds';

/**
 * Web Vitals 数据（简化版，按照参考模板）
 */
export type WebVitals = {
  lcp?: number; // ms
  cls?: number; // score
  inp?: number; // ms
};

/**
 * 一次性注入采集脚本（关键：page.addInitScript）
 * 按照参考模板优化实现
 */
export async function installWebVitalsCollector(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-ignore - 在浏览器环境中执行
    window.__vitals = { lcp: undefined, cls: 0, inp: undefined };

    // LCP
    try {
      // @ts-ignore - PerformanceObserver 类型定义可能不完整
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1] as any;
        if (last) window.__vitals.lcp = last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {}

    // CLS
    try {
      // @ts-ignore - PerformanceObserver 类型定义可能不完整
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          if (!entry.hadRecentInput) window.__vitals.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}

    // INP（事件处理延迟，简化版：取最大的 event entry）
    // 注意：浏览器支持情况不同；这段是"可用即取"的策略
    try {
      // @ts-ignore - PerformanceObserver 类型定义可能不完整
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) {
          const dur = e.duration ?? 0;
          const cur = window.__vitals.inp ?? 0;
          if (dur > cur) window.__vitals.inp = dur;
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch (e) {}
  });
}

/**
 * 读取 Web Vitals 数据
 */
export async function readWebVitals(page: Page): Promise<WebVitals> {
  try {
    if (page.isClosed()) {
      return {};
    }
    return await page.evaluate(() => {
      // @ts-ignore - 在浏览器环境中执行
      return window.__vitals || {};
    });
  } catch (error) {
    console.warn('无法获取 Web Vitals:', error);
    return {};
  }
}

/**
 * 兼容旧接口：injectVitalsScript -> installWebVitalsCollector
 */
export async function injectVitalsScript(page: Page): Promise<void> {
  return installWebVitalsCollector(page);
}

/**
 * 兼容旧接口：getWebVitals -> readWebVitals
 * 注意：保留此函数以兼容现有代码，但推荐使用 readWebVitals
 */
export const getWebVitals = readWebVitals;

/**
 * 验证 Web Vitals 是否满足阈值
 */
export function validateVitals(vitals: WebVitals, thresholds: VitalsThresholds): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];

  if (vitals.lcp !== undefined && vitals.lcp !== null) {
    if (vitals.lcp > thresholds.lcp) {
      failures.push(`LCP ${vitals.lcp}ms > ${thresholds.lcp}ms`);
    }
  }

  if (vitals.cls !== undefined && vitals.cls !== null) {
    if (vitals.cls > thresholds.cls) {
      failures.push(`CLS ${vitals.cls} > ${thresholds.cls}`);
    }
  }

  if (vitals.inp !== undefined && vitals.inp !== null) {
    if (vitals.inp > thresholds.inp) {
      failures.push(`INP ${vitals.inp}ms > ${thresholds.inp}ms`);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

