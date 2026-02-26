import { Page, Request, Response } from '@playwright/test';

/**
 * 网络请求摘要
 */
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

/**
 * 收集网络摘要
 * 记录 response >= 400、requestfailed、慢请求（> 4s）
 */
export async function collectNetworkSummary(page: Page): Promise<NetworkSummary> {
  const summary: NetworkSummary = {
    failedRequests: [],
    slowRequests: [],
    errorResponses: [],
    totalRequests: 0,
    totalFailed: 0,
    totalSlow: 0,
    totalErrors: 0,
  };

  const requests: Array<{ request: Request; response: Response | null; startTime: number; endTime?: number }> = [];

  // 监听请求
  page.on('request', (request) => {
    requests.push({
      request,
      response: null,
      startTime: Date.now(),
    });
  });

  // 监听响应
  page.on('response', (response) => {
    const requestEntry = requests.find(r => r.request === response.request());
    if (requestEntry) {
      requestEntry.response = response;
      requestEntry.endTime = Date.now();
    }
  });

  // 监听请求失败
  page.on('requestfailed', (request) => {
    const requestEntry = requests.find(r => r.request === request);
    if (requestEntry) {
      requestEntry.endTime = Date.now();
    }
  });

  // 等待所有请求完成
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // 分析请求
  for (const entry of requests) {
    summary.totalRequests++;

    const duration = entry.endTime ? entry.endTime - entry.startTime : 0;
    const url = entry.request.url();
    const method = entry.request.method();

    // 检查失败请求
    if (!entry.response) {
      summary.totalFailed++;
      summary.failedRequests.push({
        url,
        method,
        failure: 'Request failed',
      });
      continue;
    }

    // 检查错误响应（>= 400）
    const status = entry.response.status();
    if (status >= 400) {
      summary.totalErrors++;
      summary.errorResponses.push({
        url,
        method,
        status,
      });
    }

    // 检查慢请求（> 4s）
    if (duration > 4000) {
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
 * 将网络摘要附加到测试报告
 */
export async function attachNetworkSummary(page: Page, test: any): Promise<void> {
  const summary = await collectNetworkSummary(page);
  await test.info().attach('network-summary', {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json',
  });
}

/**
 * 网络收集器（参考模板版本）
 * 返回一个 getter 函数，可以在测试结束时调用获取网络摘要
 */
export function attachNetworkCollectors(page: Page): () => NetworkSummary {
  const requests: Array<{ request: Request; response: Response | null; startTime: number; endTime?: number }> = [];

  // 监听请求
  page.on('request', (request) => {
    requests.push({
      request,
      response: null,
      startTime: Date.now(),
    });
  });

  // 监听响应
  page.on('response', (response) => {
    const requestEntry = requests.find(r => r.request === response.request());
    if (requestEntry) {
      requestEntry.response = response;
      requestEntry.endTime = Date.now();
    }
  });

  // 监听请求失败
  page.on('requestfailed', (request) => {
    const requestEntry = requests.find(r => r.request === request);
    if (requestEntry) {
      requestEntry.endTime = Date.now();
    }
  });

  // 返回 getter 函数
  return () => {
    const summary: NetworkSummary = {
      failedRequests: [],
      slowRequests: [],
      errorResponses: [],
      totalRequests: 0,
      totalFailed: 0,
      totalSlow: 0,
      totalErrors: 0,
    };

    for (const entry of requests) {
      summary.totalRequests++;

      const duration = entry.endTime ? entry.endTime - entry.startTime : 0;
      const url = entry.request.url();
      const method = entry.request.method();

      if (!entry.response) {
        summary.totalFailed++;
        summary.failedRequests.push({
          url,
          method,
          failure: 'Request failed',
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

      if (duration > 4000) {
        summary.totalSlow++;
        summary.slowRequests.push({
          url,
          method,
          duration,
        });
      }
    }

    return summary;
  };
}

