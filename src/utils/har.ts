import { type Page, type TestInfo } from "@playwright/test";
import { startNetworkCapture, type NetworkCaptureEntry } from "./network";

type TestInfoLike = TestInfo | { info: () => TestInfo };

type HARPageMetadata = {
  startedDateTime?: string;
  title?: string;
  url?: string;
};

export interface HAREntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    cookies: Array<Record<string, never>>;
    headersSize: number;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<Record<string, never>>;
    content: {
      size: number;
      mimeType: string;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  timings: {
    blocked?: number;
    dns?: number;
    connect?: number;
    send: number;
    wait: number;
    receive: number;
    ssl?: number;
  };
  cache: Record<string, never>;
  serverIPAddress?: string;
}

export interface HAR {
  log: {
    version: string;
    creator: {
      name: string;
      version: string;
    };
    pages: Array<{
      startedDateTime: string;
      id: string;
      title: string;
      pageTimings: {
        onContentLoad: number;
        onLoad: number;
      };
    }>;
    entries: HAREntry[];
  };
}

function resolveTestInfo(target: TestInfoLike): TestInfo {
  return "info" in target ? target.info() : target;
}

function toHeaderArray(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value),
  }));
}

function getEntryDuration(entry: NetworkCaptureEntry): number {
  const endTime = entry.endTime ?? Date.now();
  return Math.max(endTime - entry.startTime, 0);
}

function buildHAREntry(entry: NetworkCaptureEntry): HAREntry {
  const request = entry.request;
  const response = entry.response;
  const responseHeaders = response?.headers() ?? {};
  const requestUrl = new URL(request.url());
  const duration = getEntryDuration(entry);

  return {
    startedDateTime: new Date(entry.startTime).toISOString(),
    time: duration,
    request: {
      method: request.method(),
      url: request.url(),
      httpVersion: "HTTP/1.1",
      headers: toHeaderArray(request.headers()),
      queryString: Array.from(requestUrl.searchParams.entries()).map(([name, value]) => ({
        name,
        value,
      })),
      cookies: [],
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: response?.status() ?? 0,
      statusText: response?.statusText() || entry.failureText || "Request failed",
      httpVersion: "HTTP/1.1",
      headers: toHeaderArray(responseHeaders),
      cookies: [],
      content: {
        size: -1,
        mimeType:
          responseHeaders["content-type"] ||
          responseHeaders["Content-Type"] ||
          "application/octet-stream",
      },
      redirectURL: responseHeaders.location || responseHeaders.Location || "",
      headersSize: -1,
      bodySize: -1,
    },
    timings: {
      send: 0,
      wait: duration,
      receive: 0,
    },
    cache: {},
  };
}

export function buildHAR(
  entries: readonly NetworkCaptureEntry[],
  metadata: HARPageMetadata = {},
): HAR {
  const startedDateTime = metadata.startedDateTime ?? new Date().toISOString();
  const title = metadata.title ?? metadata.url ?? "";

  return {
    log: {
      version: "1.2",
      creator: {
        name: "Playwright Synthetic Monitoring",
        version: "1.0.0",
      },
      pages: [
        {
          startedDateTime,
          id: "page_1",
          title,
          pageTimings: {
            onContentLoad: -1,
            onLoad: -1,
          },
        },
      ],
      entries: entries.map(buildHAREntry),
    },
  };
}

async function getPageMetadata(page: Page): Promise<HARPageMetadata> {
  const url = page.url();
  const title = await page.title().catch(() => url);

  return {
    startedDateTime: new Date().toISOString(),
    title,
    url,
  };
}

/**
 * 临时单页采样接口。
 * Journey 级 HAR 更推荐复用 setup 阶段启动的 network capture。
 */
export async function collectHAR(page: Page): Promise<HAR> {
  const capture = startNetworkCapture(page);

  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    return buildHAR(capture.getEntries(), await getPageMetadata(page));
  } finally {
    capture.dispose();
  }
}

export async function attachHAR(
  harOrPage: HAR | Page,
  testInfoTarget: TestInfoLike,
): Promise<void> {
  try {
    const har = "log" in harOrPage ? harOrPage : await collectHAR(harOrPage);
    const testInfo = resolveTestInfo(testInfoTarget);

    await testInfo.attach("network-har", {
      body: JSON.stringify(har, null, 2),
      contentType: "application/json",
    });
  } catch (error) {
    console.warn("无法收集 HAR 文件:", error);
  }
}
