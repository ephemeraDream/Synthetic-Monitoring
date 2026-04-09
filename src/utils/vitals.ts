import { fileURLToPath } from "node:url";
import { type Page } from "@playwright/test";
import { type VitalsThresholds } from "../config/vitals_thresholds";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

type MetricName = "CLS" | "FCP" | "INP" | "LCP" | "TTFB";

type MetricRating = "good" | "needs-improvement" | "poor";

type VitalsSupport = {
  cls: boolean;
  eventTiming: boolean;
  fcp: boolean;
  inp: boolean;
  lcp: boolean;
  ttfb: boolean;
};

export type WebVitalMetric = {
  attribution?: Record<string, JsonValue | undefined>;
  capturedAt: number;
  delta: number;
  entriesCount: number;
  id: string;
  name: MetricName;
  navigationType?: string;
  rating?: MetricRating | string;
  value: number;
};

type BrowserVitalsState = {
  capturedAt: number;
  finalized: boolean;
  initializedAt: number;
  metrics: Partial<Record<MetricName, WebVitalMetric>>;
  pageWasHidden: boolean;
  snapshots: WebVitalsSnapshot[];
  supported: VitalsSupport;
  version: number;
};

/**
 * Web Vitals 汇总数据。
 * 这里保留当前页最新指标值和原始 metric 明细，方便对齐 PSI/Lighthouse 口径。
 */
export type WebVitals = {
  capturedAt?: number;
  cls?: number;
  fcp?: number;
  finalized?: boolean;
  inp?: number;
  lcp?: number;
  metrics?: Partial<Record<MetricName, WebVitalMetric>>;
  navigationType?: string;
  pageWasHidden?: boolean;
  supported?: VitalsSupport;
  ttfb?: number;
};

/**
 * 页面级 checkpoint 快照。
 * 每个 label 都应该对应一个“页面稳定时刻”，而不是整个 Journey 末尾一把梭。
 */
export type WebVitalsSnapshot = {
  capturedAt: number;
  finalized: boolean;
  label: string;
  metrics?: Partial<Record<MetricName, WebVitalMetric>>;
  summary: WebVitals;
  title: string;
  url: string;
};

type BrowserWebVitalsApi = {
  onCLS: (callback: (metric: BrowserMetricInput) => void, options?: Record<string, unknown>) => void;
  onFCP: (callback: (metric: BrowserMetricInput) => void, options?: Record<string, unknown>) => void;
  onINP: (callback: (metric: BrowserMetricInput) => void, options?: Record<string, unknown>) => void;
  onLCP: (callback: (metric: BrowserMetricInput) => void, options?: Record<string, unknown>) => void;
  onTTFB: (callback: (metric: BrowserMetricInput) => void, options?: Record<string, unknown>) => void;
};

type BrowserMetricInput = {
  attribution?: Record<string, unknown>;
  delta?: number;
  entries?: unknown[];
  id: string;
  name: MetricName;
  navigationType?: string;
  rating?: string;
  value: number;
};

type WindowWithVitals = Window &
  typeof globalThis & {
    __journeyVitals?: BrowserVitalsState;
    __journeyVitalsFinalize?: (label?: string) => WebVitalsSnapshot;
    __journeyVitalsRead?: () => BrowserVitalsState;
    __journeyVitalsReset?: () => void;
    __journeyVitalsSnapshot?: (label: string) => WebVitalsSnapshot;
    webVitals?: BrowserWebVitalsApi;
  };

declare global {
  interface Window {
    __journeyVitals?: BrowserVitalsState;
    __journeyVitalsFinalize?: (label?: string) => WebVitalsSnapshot;
    __journeyVitalsRead?: () => BrowserVitalsState;
    __journeyVitalsReset?: () => void;
    __journeyVitalsSnapshot?: (label: string) => WebVitalsSnapshot;
    webVitals?: BrowserWebVitalsApi;
  }
}

const VITALS_COLLECTOR_VERSION = 3;
const METRIC_NAMES: MetricName[] = ["CLS", "FCP", "INP", "LCP", "TTFB"];
const WEB_VITALS_IIFE_PATH = fileURLToPath(
  new URL("../../node_modules/web-vitals/dist/web-vitals.attribution.iife.js", import.meta.url),
);

function roundMetric(value: number | undefined, digits: number): number | undefined {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }

  return Number(value.toFixed(digits));
}

function cloneMetric(metric: WebVitalMetric | undefined): WebVitalMetric | undefined {
  if (!metric) {
    return undefined;
  }

  return {
    ...metric,
    attribution: metric.attribution
      ? JSON.parse(JSON.stringify(metric.attribution)) as Record<string, JsonValue | undefined>
      : undefined,
  };
}

function cloneMetrics(
  metrics: Partial<Record<MetricName, WebVitalMetric>> | undefined,
): Partial<Record<MetricName, WebVitalMetric>> | undefined {
  if (!metrics) {
    return undefined;
  }

  const cloned: Partial<Record<MetricName, WebVitalMetric>> = {};

  for (const metricName of METRIC_NAMES) {
    const metric = cloneMetric(metrics[metricName]);
    if (metric) {
      cloned[metricName] = metric;
    }
  }

  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

function pickNavigationType(
  metrics: Partial<Record<MetricName, WebVitalMetric>> | undefined,
): string | undefined {
  if (!metrics) {
    return undefined;
  }

  for (const metricName of ["LCP", "FCP", "CLS", "INP", "TTFB"] as MetricName[]) {
    const navigationType = metrics[metricName]?.navigationType;
    if (navigationType) {
      return navigationType;
    }
  }

  return undefined;
}

function toWebVitals(state: BrowserVitalsState | undefined): WebVitals {
  if (!state) {
    return {};
  }

  return {
    lcp: roundMetric(state.metrics.LCP?.value, 2),
    cls: roundMetric(state.metrics.CLS?.value, 4),
    inp: roundMetric(state.metrics.INP?.value, 2),
    fcp: roundMetric(state.metrics.FCP?.value, 2),
    ttfb: roundMetric(state.metrics.TTFB?.value, 2),
    metrics: cloneMetrics(state.metrics),
    navigationType: pickNavigationType(state.metrics),
    supported: state.supported,
    capturedAt: roundMetric(state.capturedAt, 2),
    finalized: state.finalized,
    pageWasHidden: state.pageWasHidden,
  };
}

function buildEmptySnapshot(label: string): WebVitalsSnapshot {
  return {
    label,
    url: "",
    title: "",
    capturedAt: 0,
    finalized: false,
    summary: {},
  };
}

async function readBrowserVitalsState(page: Page): Promise<BrowserVitalsState | undefined> {
  if (page.isClosed()) {
    return undefined;
  }

  return page.evaluate(() => {
    const win = window as WindowWithVitals;
    return win.__journeyVitalsRead?.();
  });
}

/**
 * 在导航前注入官方 web-vitals attribution 采集器。
 * 重点变化：
 * 1. 改用官方实现，减少手写 observer 与 PSI/Lighthouse 口径漂移。
 * 2. 保存当前页最新 metric + attribution，便于按页面 checkpoint 采集。
 * 3. 提供 snapshot / finalize / reset 接口，支持 Journey 多页面分段记录。
 */
export async function installWebVitalsCollector(page: Page): Promise<void> {
  await page.addInitScript({ path: WEB_VITALS_IIFE_PATH });

  await page.addInitScript((collectorVersion: number) => {
    type MetricName = "CLS" | "FCP" | "INP" | "LCP" | "TTFB";

    type JsonValue =
      | string
      | number
      | boolean
      | null
      | JsonValue[]
      | { [key: string]: JsonValue | undefined };

    type VitalsSupport = {
      cls: boolean;
      eventTiming: boolean;
      fcp: boolean;
      inp: boolean;
      lcp: boolean;
      ttfb: boolean;
    };

    type MetricInput = {
      attribution?: Record<string, unknown>;
      delta?: number;
      entries?: unknown[];
      id: string;
      name: MetricName;
      navigationType?: string;
      rating?: string;
      value: number;
    };

    type MetricRecord = {
      attribution?: Record<string, JsonValue | undefined>;
      capturedAt: number;
      delta: number;
      entriesCount: number;
      id: string;
      name: MetricName;
      navigationType?: string;
      rating?: string;
      value: number;
    };

    type WebVitals = {
      capturedAt?: number;
      cls?: number;
      fcp?: number;
      finalized?: boolean;
      inp?: number;
      lcp?: number;
      metrics?: Partial<Record<MetricName, MetricRecord>>;
      navigationType?: string;
      pageWasHidden?: boolean;
      supported?: VitalsSupport;
      ttfb?: number;
    };

    type Snapshot = {
      capturedAt: number;
      finalized: boolean;
      label: string;
      metrics?: Partial<Record<MetricName, MetricRecord>>;
      summary: WebVitals;
      title: string;
      url: string;
    };

    type State = {
      capturedAt: number;
      finalized: boolean;
      initializedAt: number;
      metrics: Partial<Record<MetricName, MetricRecord>>;
      pageWasHidden: boolean;
      snapshots: Snapshot[];
      supported: VitalsSupport;
      version: number;
    };

    type WebVitalsApi = {
      onCLS: (callback: (metric: MetricInput) => void, options?: Record<string, unknown>) => void;
      onFCP: (callback: (metric: MetricInput) => void, options?: Record<string, unknown>) => void;
      onINP: (callback: (metric: MetricInput) => void, options?: Record<string, unknown>) => void;
      onLCP: (callback: (metric: MetricInput) => void, options?: Record<string, unknown>) => void;
      onTTFB: (callback: (metric: MetricInput) => void, options?: Record<string, unknown>) => void;
    };

    type WindowWithVitals = Window &
      typeof globalThis & {
        __journeyVitals?: State;
        __journeyVitalsFinalize?: (label?: string) => Snapshot;
        __journeyVitalsRead?: () => State;
        __journeyVitalsReset?: () => void;
        __journeyVitalsSnapshot?: (label: string) => Snapshot;
        webVitals?: WebVitalsApi;
      };

    const win = window as WindowWithVitals;

    if (win.__journeyVitals?.version === collectorVersion) {
      return;
    }

    const metricNames: MetricName[] = ["CLS", "FCP", "INP", "LCP", "TTFB"];
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

    const now = () => performance.now();

    const round = (value: number | undefined, digits: number): number | undefined => {
      if (value == null || !Number.isFinite(value)) {
        return undefined;
      }

      return Number(value.toFixed(digits));
    };

    const state: State = {
      version: collectorVersion,
      initializedAt: round(now(), 2) ?? 0,
      capturedAt: round(now(), 2) ?? 0,
      finalized: false,
      pageWasHidden: document.visibilityState === "hidden",
      supported: support,
      metrics: {},
      snapshots: [],
    };

    const sanitizeObject = (
      value: unknown,
      depth = 0,
      seen = new WeakSet<object>(),
    ): JsonValue | undefined => {
      if (value == null) {
        return null;
      }

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return value;
      }

      if (depth > 3) {
        return undefined;
      }

      if (Array.isArray(value)) {
        return value
          .slice(0, 10)
          .map((item) => sanitizeObject(item, depth + 1, seen))
          .filter((item) => item !== undefined) as JsonValue[];
      }

      if (typeof value !== "object") {
        return undefined;
      }

      if (seen.has(value)) {
        return undefined;
      }
      seen.add(value);

      const candidate = value as Record<string, unknown>;

      if ("nodeType" in candidate && "nodeName" in candidate) {
        return undefined;
      }

      const entryKeys = [
        "name",
        "entryType",
        "startTime",
        "duration",
        "processingStart",
        "processingEnd",
        "renderTime",
        "loadTime",
        "size",
        "url",
        "value",
        "hadRecentInput",
        "interactionId",
        "responseStart",
        "requestStart",
        "responseEnd",
        "connectStart",
        "connectEnd",
        "domainLookupStart",
        "domainLookupEnd",
        "fetchStart",
        "workerStart",
        "activationStart",
        "sourceURL",
        "sourceFunctionName",
        "invoker",
      ];

      const output: Record<string, JsonValue | undefined> = {};

      for (const key of entryKeys) {
        if (!(key in candidate)) {
          continue;
        }

        const sanitized = sanitizeObject(candidate[key], depth + 1, seen);
        if (sanitized !== undefined) {
          output[key] = sanitized;
        }
      }

      for (const [key, nestedValue] of Object.entries(candidate).slice(0, 20)) {
        if (key in output) {
          continue;
        }

        const sanitized = sanitizeObject(nestedValue, depth + 1, seen);
        if (sanitized !== undefined) {
          output[key] = sanitized;
        }
      }

      return Object.keys(output).length > 0 ? output : undefined;
    };

    const cloneMetrics = (): Partial<Record<MetricName, MetricRecord>> | undefined => {
      const output: Partial<Record<MetricName, MetricRecord>> = {};

      for (const metricName of metricNames) {
        const metric = state.metrics[metricName];
        if (!metric) {
          continue;
        }

        output[metricName] = {
          ...metric,
          attribution: metric.attribution
            ? JSON.parse(JSON.stringify(metric.attribution)) as Record<string, JsonValue | undefined>
            : undefined,
        };
      }

      return Object.keys(output).length > 0 ? output : undefined;
    };

    const pickNavigationType = (): string | undefined => {
      for (const metricName of ["LCP", "FCP", "CLS", "INP", "TTFB"] as MetricName[]) {
        const navigationType = state.metrics[metricName]?.navigationType;
        if (navigationType) {
          return navigationType;
        }
      }

      return undefined;
    };

    const buildSummary = (): WebVitals => ({
      lcp: round(state.metrics.LCP?.value, 2),
      cls: round(state.metrics.CLS?.value, 4),
      inp: round(state.metrics.INP?.value, 2),
      fcp: round(state.metrics.FCP?.value, 2),
      ttfb: round(state.metrics.TTFB?.value, 2),
      metrics: cloneMetrics(),
      navigationType: pickNavigationType(),
      supported: state.supported,
      capturedAt: round(state.capturedAt, 2),
      finalized: state.finalized,
      pageWasHidden: state.pageWasHidden,
    });

    const buildSnapshot = (label: string): Snapshot => ({
      label,
      url: location.href,
      title: document.title,
      capturedAt: round(state.capturedAt, 2) ?? 0,
      finalized: state.finalized,
      summary: buildSummary(),
      metrics: cloneMetrics(),
    });

    const updateMetric = (metric: MetricInput) => {
      if (!metric?.name || !Number.isFinite(metric.value)) {
        return;
      }

      state.metrics[metric.name] = {
        name: metric.name,
        id: metric.id,
        value: round(metric.value, 4) ?? metric.value,
        delta: round(metric.delta ?? metric.value, 4) ?? metric.value,
        rating: metric.rating,
        navigationType: metric.navigationType,
        entriesCount: Array.isArray(metric.entries) ? metric.entries.length : 0,
        attribution: sanitizeObject(metric.attribution) as Record<string, JsonValue | undefined> | undefined,
        capturedAt: round(now(), 2) ?? 0,
      };
      state.capturedAt = round(now(), 2) ?? 0;
    };

    const snapshot = (label: string) => {
      state.capturedAt = round(now(), 2) ?? 0;
      const current = buildSnapshot(label);
      state.snapshots.push(current);
      return current;
    };

    const reset = () => {
      state.initializedAt = round(now(), 2) ?? 0;
      state.capturedAt = state.initializedAt;
      state.finalized = false;
      state.pageWasHidden = document.visibilityState === "hidden";
      state.metrics = {};
      state.snapshots = [];
    };

    win.__journeyVitals = state;
    win.__journeyVitalsRead = () => state;
    win.__journeyVitalsSnapshot = snapshot;
    win.__journeyVitalsFinalize = (label = "final") => {
      state.pageWasHidden = state.pageWasHidden || document.visibilityState === "hidden";
      state.finalized = true;
      return snapshot(label);
    };
    win.__journeyVitalsReset = reset;

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") {
          state.pageWasHidden = true;
        }
      },
      true,
    );

    win.addEventListener(
      "pagehide",
      () => {
        state.pageWasHidden = true;
      },
      true,
    );

    const api = win.webVitals;
    if (!api) {
      return;
    }

    api.onCLS(updateMetric, { reportAllChanges: true });
    api.onLCP(updateMetric, { reportAllChanges: true });
    api.onFCP(updateMetric);
    api.onTTFB(updateMetric);
    api.onINP(updateMetric, {
      reportAllChanges: true,
      durationThreshold: 40,
    });
  }, VITALS_COLLECTOR_VERSION);
}

/**
 * 读取当前页当前时刻的最新 Web Vitals 汇总值。
 * 适合调试或兼容旧接口，不适合 Journey 末尾一把梭地当成整条链路指标。
 */
export async function readWebVitals(page: Page): Promise<WebVitals> {
  try {
    const vitalsState = await readBrowserVitalsState(page);
    return toWebVitals(vitalsState);
  } catch (error) {
    console.warn("无法获取 Web Vitals:", error);
    return {};
  }
}

/**
 * 对当前页做一个 checkpoint 快照。
 * label 应该是页面语义，例如 home / search-results / pdp / cart / checkout。
 */
export async function snapshotWebVitals(
  page: Page,
  label: string,
): Promise<WebVitalsSnapshot> {
  try {
    if (page.isClosed()) {
      return buildEmptySnapshot(label);
    }

    const snapshot = await page.evaluate((snapshotLabel: string) => {
      const win = window as WindowWithVitals;
      return win.__journeyVitalsSnapshot?.(snapshotLabel);
    }, label);

    return snapshot ?? buildEmptySnapshot(label);
  } catch (error) {
    console.warn("无法生成 Web Vitals checkpoint:", error);
    return buildEmptySnapshot(label);
  }
}

/**
 * 结束当前页采集并读取最终快照。
 * 这个“最终”只代表当前页，不代表整个 Journey 的所有页面。
 */
export async function finalizeWebVitals(
  page: Page,
  label = "final",
): Promise<WebVitalsSnapshot> {
  try {
    if (page.isClosed()) {
      return buildEmptySnapshot(label);
    }

    const snapshot = await page.evaluate((snapshotLabel: string) => {
      const win = window as WindowWithVitals;
      return win.__journeyVitalsFinalize?.(snapshotLabel);
    }, label);

    return snapshot ?? buildEmptySnapshot(label);
  } catch (error) {
    console.warn("无法 finalize Web Vitals:", error);
    return buildEmptySnapshot(label);
  }
}

/**
 * 在同一文档内需要重新开始统计时，可显式 reset。
 * 当前多页 Journey 主要依赖导航自动重建文档，这个接口先留给后续 SPA 扩展。
 */
export async function resetWebVitalsSession(page: Page): Promise<void> {
  try {
    if (page.isClosed()) {
      return;
    }

    await page.evaluate(() => {
      const win = window as WindowWithVitals;
      win.__journeyVitalsReset?.();
    });
  } catch (error) {
    console.warn("无法 reset Web Vitals:", error);
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
