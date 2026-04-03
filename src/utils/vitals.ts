import { type Page } from "@playwright/test";
import { type VitalsThresholds } from "../config/vitals_thresholds";

type VitalsSupport = {
  cls: boolean;
  eventTiming: boolean;
  fcp: boolean;
  inp: boolean;
  lcp: boolean;
  ttfb: boolean;
};

type BrowserVitalsState = {
  capturedAt: number;
  cls: number;
  fcp?: number;
  finalized: boolean;
  inp?: number;
  lcp?: number;
  pageWasHidden: boolean;
  supported: VitalsSupport;
  ttfb?: number;
  version: number;
};

/**
 * Web Vitals 数据。
 * 额外保留 supported/capturedAt/finalized，方便排查采集是否真的生效。
 */
export type WebVitals = {
  capturedAt?: number;
  cls?: number;
  fcp?: number;
  finalized?: boolean;
  inp?: number;
  lcp?: number;
  pageWasHidden?: boolean;
  supported?: VitalsSupport;
  ttfb?: number;
};

type PaintEntry = PerformanceEntry & {
  name: string;
  startTime: number;
};

type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput?: boolean;
  startTime: number;
  value?: number;
};

type LargestContentfulPaintEntry = PerformanceEntry & {
  loadTime?: number;
  renderTime?: number;
  startTime: number;
};

type InteractionTimingEntry = PerformanceEntry & {
  duration?: number;
  interactionId?: number;
  processingEnd?: number;
  startTime: number;
};

type WindowWithVitals = Window &
  typeof globalThis & {
    __vitals?: BrowserVitalsState;
    __vitalsFinalize?: () => void;
    __vitalsFlush?: () => void;
  };

type ObserverInitWithThreshold = PerformanceObserverInit & {
  durationThreshold?: number;
};

declare global {
  interface Window {
    __vitals?: BrowserVitalsState;
    __vitalsFinalize?: () => void;
    __vitalsFlush?: () => void;
  }
}

const VITALS_COLLECTOR_VERSION = 2;

function roundMetric(value: number | undefined, digits: number): number | undefined {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }

  return Number(value.toFixed(digits));
}

function toWebVitals(state: BrowserVitalsState | undefined): WebVitals {
  if (!state) {
    return {};
  }

  return {
    lcp: state.supported.lcp ? roundMetric(state.lcp, 2) : undefined,
    cls: state.supported.cls ? roundMetric(state.cls, 4) ?? 0 : undefined,
    inp: state.supported.inp ? roundMetric(state.inp, 2) : undefined,
    fcp: state.supported.fcp ? roundMetric(state.fcp, 2) : undefined,
    ttfb: state.supported.ttfb ? roundMetric(state.ttfb, 2) : undefined,
    supported: state.supported,
    capturedAt: roundMetric(state.capturedAt, 2),
    finalized: state.finalized,
    pageWasHidden: state.pageWasHidden,
  };
}

/**
 * 在导航前注入 Web Vitals 采集器。
 * 重点修正点：
 * 1. CLS 使用 session window 计算，而不是简单累加。
 * 2. LCP 在 flush / hidden / pagehide 时都会补采最后记录。
 * 3. INP 按 interactionId 聚合，取每次交互的最大延迟，再取全局最大值。
 */
export async function installWebVitalsCollector(page: Page): Promise<void> {
  await page.addInitScript((collectorVersion: number) => {
    const win = window as WindowWithVitals;

    if (win.__vitals?.version === collectorVersion) {
      return;
    }

    const supportedEntryTypes =
      "PerformanceObserver" in win &&
      Array.isArray(win.PerformanceObserver.supportedEntryTypes)
        ? win.PerformanceObserver.supportedEntryTypes
        : [];

    const support: VitalsSupport = {
      lcp: supportedEntryTypes.includes("largest-contentful-paint"),
      cls: supportedEntryTypes.includes("layout-shift"),
      inp: supportedEntryTypes.includes("event"),
      eventTiming: supportedEntryTypes.includes("event"),
      fcp: supportedEntryTypes.includes("paint"),
      ttfb: "PerformanceNavigationTiming" in win,
    };

    const state: BrowserVitalsState = {
      version: collectorVersion,
      lcp: undefined,
      cls: 0,
      inp: undefined,
      fcp: undefined,
      ttfb: undefined,
      supported: support,
      capturedAt: 0,
      finalized: false,
      pageWasHidden: false,
    };

    win.__vitals = state;

    const flushers: Array<() => void> = [];
    const cleaners: Array<() => void> = [];

    let clsWindowValue = 0;
    let clsWindowEntries: LayoutShiftEntry[] = [];
    const interactionLatencies = new Map<number, number>();

    const updateCapturedAt = () => {
      state.capturedAt = performance.now();
    };

    const updateTTFB = () => {
      const navEntry = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;

      if (navEntry && navEntry.responseStart > 0) {
        state.ttfb = navEntry.responseStart;
      }
    };

    const updateFCPFromEntries = () => {
      const paintEntries = performance.getEntriesByType("paint") as PaintEntry[];
      const fcpEntry = paintEntries.find((entry) => entry.name === "first-contentful-paint");

      if (fcpEntry) {
        state.fcp = fcpEntry.startTime;
      }
    };

    const handleLcpEntries = (entries: PerformanceEntry[]) => {
      const typedEntries = entries as LargestContentfulPaintEntry[];
      const lastEntry = typedEntries[typedEntries.length - 1];

      if (!lastEntry) {
        return;
      }

      state.lcp =
        lastEntry.startTime || lastEntry.renderTime || lastEntry.loadTime || state.lcp;
      updateCapturedAt();
    };

    const handleClsEntries = (entries: PerformanceEntry[]) => {
      const typedEntries = entries as LayoutShiftEntry[];

      for (const entry of typedEntries) {
        if (!entry || entry.hadRecentInput || entry.value == null) {
          continue;
        }

        const firstSessionEntry = clsWindowEntries[0];
        const lastSessionEntry = clsWindowEntries[clsWindowEntries.length - 1];

        if (
          lastSessionEntry &&
          firstSessionEntry &&
          entry.startTime - lastSessionEntry.startTime < 1000 &&
          entry.startTime - firstSessionEntry.startTime < 5000
        ) {
          clsWindowValue += entry.value;
          clsWindowEntries.push(entry);
        } else {
          clsWindowValue = entry.value;
          clsWindowEntries = [entry];
        }

        if (clsWindowValue > state.cls) {
          state.cls = clsWindowValue;
        }
      }

      updateCapturedAt();
    };

    const handleInpEntries = (entries: PerformanceEntry[]) => {
      const typedEntries = entries as InteractionTimingEntry[];

      for (const entry of typedEntries) {
        const interactionId = entry.interactionId ?? 0;
        if (!interactionId) {
          continue;
        }

        const candidateDuration = Math.max(
          entry.duration ?? 0,
          (entry.processingEnd ?? 0) - entry.startTime,
        );

        if (candidateDuration <= 0) {
          continue;
        }

        const previousInteractionDuration = interactionLatencies.get(interactionId) ?? 0;
        if (candidateDuration > previousInteractionDuration) {
          interactionLatencies.set(interactionId, candidateDuration);
        }

        const currentInp = state.inp ?? 0;
        if (candidateDuration > currentInp) {
          state.inp = candidateDuration;
        }
      }

      updateCapturedAt();
    };

    const observeEntries = (
      handler: (entries: PerformanceEntry[]) => void,
      options: PerformanceObserverInit | ObserverInitWithThreshold,
    ) => {
      const observer = new PerformanceObserver((list) => {
        handler(list.getEntries());
      });

      observer.observe(options as PerformanceObserverInit);

      flushers.push(() => {
        handler(observer.takeRecords());
      });

      cleaners.push(() => {
        observer.disconnect();
      });
    };

    const flush = () => {
      updateTTFB();
      updateFCPFromEntries();

      for (const flusher of flushers) {
        flusher();
      }

      updateCapturedAt();
    };

    const finalize = () => {
      if (state.finalized) {
        return;
      }

      state.pageWasHidden = document.visibilityState === "hidden" || state.pageWasHidden;
      flush();

      for (const cleanup of cleaners) {
        cleanup();
      }

      state.finalized = true;
      updateCapturedAt();
    };

    win.__vitalsFlush = flush;
    win.__vitalsFinalize = finalize;

    updateTTFB();
    updateFCPFromEntries();

    if (support.lcp) {
      observeEntries(handleLcpEntries, {
        type: "largest-contentful-paint",
        buffered: true,
      });
    }

    if (support.cls) {
      observeEntries(handleClsEntries, {
        type: "layout-shift",
        buffered: true,
      });
    }

    if (support.inp) {
      const eventObserverOptions: ObserverInitWithThreshold = {
        type: "event",
        buffered: true,
        durationThreshold: 16,
      };
      observeEntries(handleInpEntries, eventObserverOptions);
    }

    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        state.pageWasHidden = true;
        finalize();
      }
    };

    const onPageHide = () => {
      state.pageWasHidden = true;
      finalize();
    };

    document.addEventListener("visibilitychange", onHidden, true);
    win.addEventListener("pagehide", onPageHide, true);

    cleaners.push(() => {
      document.removeEventListener("visibilitychange", onHidden, true);
      win.removeEventListener("pagehide", onPageHide, true);
    });

    updateCapturedAt();
  }, VITALS_COLLECTOR_VERSION);
}

/**
 * 读取当前 Web Vitals 快照。
 * 这里会先 flush 已缓存的 observer 记录，但不会强制 finalize，
 * 这样中途读取也不会中断后续采集。
 */
export async function readWebVitals(page: Page): Promise<WebVitals> {
  try {
    if (page.isClosed()) {
      return {};
    }

    const vitals = await page.evaluate(() => {
      const win = window as WindowWithVitals;
      win.__vitalsFlush?.();
      return win.__vitals;
    });

    return toWebVitals(vitals ?? undefined);
  } catch (error) {
    console.warn("无法获取 Web Vitals:", error);
    return {};
  }
}

/**
 * 在确实要结束采集时，可显式 finalize 再读取。
 * 当前主流程不用强依赖，但保留这个接口方便后续扩展。
 */
export async function finalizeWebVitals(page: Page): Promise<WebVitals> {
  try {
    if (page.isClosed()) {
      return {};
    }

    const vitals = await page.evaluate(() => {
      const win = window as WindowWithVitals;
      win.__vitalsFinalize?.();
      return win.__vitals;
    });

    return toWebVitals(vitals ?? undefined);
  } catch (error) {
    console.warn("无法 finalize Web Vitals:", error);
    return {};
  }
}

/**
 * 兼容旧接口：injectVitalsScript -> installWebVitalsCollector
 */
export async function injectVitalsScript(page: Page): Promise<void> {
  await installWebVitalsCollector(page);
}

/**
 * 兼容旧接口：getWebVitals -> readWebVitals
 */
export const getWebVitals = readWebVitals;

/**
 * 校验 Web Vitals 是否超过阈值。
 * 只校验有值的指标，不会因为浏览器不支持而硬失败。
 */
export function validateVitals(
  vitals: WebVitals,
  thresholds: VitalsThresholds,
): {
  failures: string[];
  passed: boolean;
} {
  const failures: string[] = [];

  if (vitals.lcp != null && vitals.lcp > thresholds.lcp) {
    failures.push(`LCP ${vitals.lcp}ms > ${thresholds.lcp}ms`);
  }

  if (vitals.cls != null && vitals.cls > thresholds.cls) {
    failures.push(`CLS ${vitals.cls} > ${thresholds.cls}`);
  }

  if (vitals.inp != null && vitals.inp > thresholds.inp) {
    failures.push(`INP ${vitals.inp}ms > ${thresholds.inp}ms`);
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
