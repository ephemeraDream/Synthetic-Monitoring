import { type Page, type Request, type Response, type TestInfo } from "@playwright/test";

const SLOW_REQUEST_THRESHOLD_MS = 4000;

type TestInfoLike = TestInfo | { info: () => TestInfo };

export interface NetworkSummary {
  failedRequests: Array<{
    url: string;
    method: string;
    failure?: string;
  }>;
  slowRequests: Array<{
    url: string;
    method: string;
    duration: number;
  }>;
  errorResponses: Array<{
    url: string;
    method: string;
    status: number;
  }>;
  totalRequests: number;
  totalFailed: number;
  totalSlow: number;
  totalErrors: number;
}

export type NetworkCaptureEntry = {
  endTime?: number;
  failureText?: string;
  request: Request;
  response: Response | null;
  startTime: number;
};

export interface NetworkCapture {
  dispose: () => void;
  getEntries: () => NetworkCaptureEntry[];
  getSummary: () => NetworkSummary;
}

function createEmptySummary(): NetworkSummary {
  return {
    failedRequests: [],
    slowRequests: [],
    errorResponses: [],
    totalRequests: 0,
    totalFailed: 0,
    totalSlow: 0,
    totalErrors: 0,
  };
}

function resolveTestInfo(target: TestInfoLike): TestInfo {
  return "info" in target ? target.info() : target;
}

function getRequestDuration(entry: NetworkCaptureEntry): number {
  const endTime = entry.endTime ?? Date.now();
  return Math.max(endTime - entry.startTime, 0);
}

function buildNetworkSummary(entries: readonly NetworkCaptureEntry[]): NetworkSummary {
  const summary = createEmptySummary();

  for (const entry of entries) {
    summary.totalRequests++;

    const duration = getRequestDuration(entry);
    const url = entry.request.url();
    const method = entry.request.method();

    if (!entry.response) {
      summary.totalFailed++;
      summary.failedRequests.push({
        url,
        method,
        failure: entry.failureText ?? "Request failed",
      });
      continue;
    }

    const status = entry.response.status();
    if (status >= 400) {
      summary.totalErrors++;
      summary.errorResponses.push({
        url,
        method,
        status,
      });
    }

    if (duration > SLOW_REQUEST_THRESHOLD_MS) {
      summary.totalSlow++;
      summary.slowRequests.push({
        url,
        method,
        duration,
      });
    }
  }

  return summary;
}

/**
 * 在 Journey 开始阶段启动网络抓取，避免“测试跑完了才开始录证据”。
 */
export function startNetworkCapture(page: Page): NetworkCapture {
  const entries: NetworkCaptureEntry[] = [];
  const requestsByObject = new Map<Request, NetworkCaptureEntry>();

  const onRequest = (request: Request) => {
    const entry: NetworkCaptureEntry = {
      request,
      response: null,
      startTime: Date.now(),
    };

    entries.push(entry);
    requestsByObject.set(request, entry);
  };

  const onResponse = (response: Response) => {
    const entry = requestsByObject.get(response.request());
    if (!entry) {
      return;
    }

    entry.response = response;
    entry.endTime ??= Date.now();
  };

  const onRequestFailed = (request: Request) => {
    const entry = requestsByObject.get(request);
    if (!entry) {
      return;
    }

    entry.endTime ??= Date.now();
    entry.failureText = request.failure()?.errorText || "Request failed";
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  return {
    dispose: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
    },
    getEntries: () => entries.map((entry) => ({ ...entry })),
    getSummary: () => buildNetworkSummary(entries),
  };
}

/**
 * 临时单页采样接口。
 * 适合 ad-hoc 调试；Journey 场景应优先在测试开始时启动 startNetworkCapture。
 */
export async function collectNetworkSummary(page: Page): Promise<NetworkSummary> {
  const capture = startNetworkCapture(page);

  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    return capture.getSummary();
  } finally {
    capture.dispose();
  }
}

export async function attachNetworkSummary(
  page: Page,
  testInfoTarget: TestInfoLike,
): Promise<void> {
  const summary = await collectNetworkSummary(page);
  const testInfo = resolveTestInfo(testInfoTarget);

  await testInfo.attach("network-summary", {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json",
  });
}

/**
 * 兼容旧模板：返回 getter，调用时读取当前已捕获到的网络摘要。
 */
export function attachNetworkCollectors(page: Page): () => NetworkSummary {
  const capture = startNetworkCapture(page);
  return () => capture.getSummary();
}
