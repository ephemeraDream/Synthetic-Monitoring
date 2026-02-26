import { Page, Request, Response } from '@playwright/test';

/**
 * HAR (HTTP Archive) 文件格式接口
 * 用于导出完整的网络请求记录，便于在浏览器中分析
 */
export interface HAREntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    cookies: Array<any>;
    headersSize: number;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<any>;
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
  cache: {};
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

/**
 * 收集并导出 HAR 文件
 * HAR 文件可以在 Chrome DevTools 或 HAR Analyzer 中打开分析
 * 
 * 注意：使用 Playwright 的 request/response 事件收集，更可靠
 */
export async function collectHAR(page: Page): Promise<HAR> {
  const entries: HAREntry[] = [];
  const requestMap = new Map<string, { request: Request; startTime: number }>();

  // 监听请求
  page.on('request', (request) => {
    requestMap.set(request.url(), {
      request,
      startTime: Date.now(),
    });
  });

  // 监听响应
  page.on('response', async (response) => {
    const requestData = requestMap.get(response.request().url());
    if (requestData) {
      const request = requestData.request;
      const endTime = Date.now();
      const duration = endTime - requestData.startTime;

      try {
        // 获取请求头
        const requestHeaders = request.headers();
        const headers = Object.entries(requestHeaders).map(([name, value]) => ({
          name,
          value: String(value),
        }));

        // 获取响应头
        const responseHeaders = response.headers();
        const responseHeadersArray = Object.entries(responseHeaders).map(([name, value]) => ({
          name,
          value: String(value),
        }));

        // 解析 URL
        const url = new URL(request.url());
        const queryString = Array.from(url.searchParams.entries()).map(([name, value]) => ({
          name,
          value,
        }));

        // 构建 HAR 条目
        const entry: HAREntry = {
          startedDateTime: new Date(requestData.startTime).toISOString(),
          time: duration,
          request: {
            method: request.method(),
            url: request.url(),
            httpVersion: 'HTTP/1.1',
            headers,
            queryString,
            cookies: [],
            headersSize: -1,
            bodySize: -1,
          },
          response: {
            status: response.status(),
            statusText: response.statusText(),
            httpVersion: 'HTTP/1.1',
            headers: responseHeadersArray,
            cookies: [],
            content: {
              size: -1,
              mimeType: responseHeaders['content-type'] || responseHeaders['Content-Type'] || 'application/octet-stream',
            },
            redirectURL: '',
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

        entries.push(entry);
      } catch (error) {
        // 忽略单个请求的错误，继续处理其他请求
        console.warn(`无法处理请求 ${request.url()}:`, error);
      }
    }
  });

  // 等待所有请求完成
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // 构建 HAR 文件
  const har: HAR = {
    log: {
      version: '1.2',
      creator: {
        name: 'Playwright Synthetic Monitoring',
        version: '1.0.0',
      },
      pages: [
        {
          startedDateTime: new Date().toISOString(),
          id: 'page_1',
          title: page.url(),
          pageTimings: {
            onContentLoad: -1,
            onLoad: -1,
          },
        },
      ],
      entries,
    },
  };

  return har;
}

/**
 * 将 HAR 数据附加到测试报告
 */
export async function attachHAR(page: Page, testInfo: any): Promise<void> {
  try {
    const har = await collectHAR(page);
    await testInfo.attach('network-har', {
      body: JSON.stringify(har, null, 2),
      contentType: 'application/json',
      fileName: 'network.har',
    });
  } catch (error) {
    console.warn('无法收集 HAR 文件:', error);
    // 不阻塞测试
  }
}

