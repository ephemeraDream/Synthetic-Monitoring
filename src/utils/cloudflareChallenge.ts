import { type Page, type Response } from "@playwright/test";

const CHALLENGE_BODY_PATTERNS = [
  /your connection needs to be verified before you can proceed/i,
  /verify you are human/i,
  /performing security verification/i,
  /checking if the site connection is secure/i,
];
const CHALLENGE_TITLE_PATTERNS = [
  /^just a moment/i,
  /attention required/i,
  /security verification/i,
];
const CHALLENGE_ROOT_SELECTOR = [
  "#challenge-stage",
  "#challenge-running",
  "#challenge-form",
  ".main-wrapper #challenge-stage",
].join(", ");
const CHALLENGE_FRAME_SELECTOR = [
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[title*="Cloudflare security challenge" i]',
].join(", ");
const DEFAULT_RESOLUTION_TIMEOUT_MS = 12000;
const POLL_INTERVAL_MS = 500;

export type CloudflareChallengeOccurrence = {
  detectedAt: string;
  resolvedAt?: string;
  signals: string[];
  sources: Array<"dom" | "response">;
  title: string;
  url: string;
};

export type CloudflareChallengeCapture = {
  dispose: () => void;
  getOccurrences: () => CloudflareChallengeOccurrence[];
};

export type CloudflareChallengeResolution =
  | "not-detected"
  | "resolved"
  | "blocked";

type ChallengeState = {
  active?: CloudflareChallengeOccurrence;
  occurrences: CloudflareChallengeOccurrence[];
};

const states = new WeakMap<Page, ChallengeState>();

function getState(page: Page): ChallengeState {
  let state = states.get(page);

  if (!state) {
    state = { occurrences: [] };
    states.set(page, state);
  }

  return state;
}

function cloneOccurrence(
  occurrence: CloudflareChallengeOccurrence,
): CloudflareChallengeOccurrence {
  return {
    ...occurrence,
    signals: [...occurrence.signals],
    sources: [...occurrence.sources],
  };
}

function markChallengeResolved(page: Page): void {
  const state = getState(page);

  if (state.active && !state.active.resolvedAt) {
    state.active.resolvedAt = new Date().toISOString();
  }

  state.active = undefined;
}

function recordChallenge(
  page: Page,
  occurrence: Omit<CloudflareChallengeOccurrence, "detectedAt" | "sources"> & {
    source: "dom" | "response";
  },
): CloudflareChallengeOccurrence {
  const state = getState(page);

  if (state.active) {
    if (!state.active.sources.includes(occurrence.source)) {
      state.active.sources.push(occurrence.source);
    }

    state.active.signals = Array.from(
      new Set([...state.active.signals, ...occurrence.signals]),
    );
    state.active.title ||= occurrence.title;
    state.active.url ||= occurrence.url;
    return state.active;
  }

  const detected: CloudflareChallengeOccurrence = {
    detectedAt: new Date().toISOString(),
    signals: [...occurrence.signals],
    sources: [occurrence.source],
    title: occurrence.title,
    url: occurrence.url,
  };

  state.active = detected;
  state.occurrences.push(detected);
  return detected;
}

function isMainDocumentResponse(page: Page, response: Response): boolean {
  const request = response.request();
  return request.isNavigationRequest() && request.frame() === page.mainFrame();
}

/**
 * 记录 Cloudflare 在主文档响应头中明确标记的 challenge。
 */
export function startCloudflareChallengeCapture(
  page: Page,
): CloudflareChallengeCapture {
  const onResponse = (response: Response) => {
    if (!isMainDocumentResponse(page, response)) {
      return;
    }

    const mitigated = response.headers()["cf-mitigated"]?.toLowerCase();
    if (mitigated === "challenge") {
      recordChallenge(page, {
        signals: ["response-header:cf-mitigated=challenge"],
        source: "response",
        title: "",
        url: response.url(),
      });
      return;
    }

    markChallengeResolved(page);
  };

  page.on("response", onResponse);

  return {
    dispose: () => page.off("response", onResponse),
    getOccurrences: () =>
      getState(page).occurrences.map(cloneOccurrence),
  };
}

/**
 * DOM 检测只使用 challenge 页强特征，避免把普通页面内嵌的 Turnstile 表单误判为拦截页。
 */
export async function inspectCloudflareChallenge(
  page: Page,
): Promise<CloudflareChallengeOccurrence | null> {
  if (page.isClosed()) {
    return null;
  }

  const [title, bodyText, challengeRootCount, challengeFrameCount] =
    await Promise.all([
      page.title().catch(() => ""),
      page.locator("body").innerText({ timeout: 2000 }).catch(() => ""),
      page.locator(CHALLENGE_ROOT_SELECTOR).count().catch(() => 0),
      page.locator(CHALLENGE_FRAME_SELECTOR).count().catch(() => 0),
    ]);
  const signals: string[] = [];

  for (const pattern of CHALLENGE_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      signals.push(`title:${pattern.source}`);
      break;
    }
  }

  for (const pattern of CHALLENGE_BODY_PATTERNS) {
    if (pattern.test(bodyText)) {
      signals.push(`body:${pattern.source}`);
      break;
    }
  }

  if (challengeRootCount > 0) {
    signals.push("dom:challenge-root");
  }

  if (challengeFrameCount > 0) {
    signals.push("dom:challenge-frame");
  }

  const strongTextSignal = signals.some((signal) =>
    signal.startsWith("title:") || signal.startsWith("body:"),
  );
  const structuralSignal = challengeRootCount > 0 && challengeFrameCount > 0;

  if (!strongTextSignal && !structuralSignal) {
    const responseDetected = getState(page).active?.sources.includes("response");
    if (responseDetected) {
      return cloneOccurrence(getState(page).active!);
    }

    markChallengeResolved(page);
    return null;
  }

  return cloneOccurrence(
    recordChallenge(page, {
      signals,
      source: "dom",
      title,
      url: page.url(),
    }),
  );
}

export async function isCloudflareChallengePage(page: Page): Promise<boolean> {
  return (await inspectCloudflareChallenge(page)) !== null;
}

/**
 * 只等待 Cloudflare 自己完成自动校验，不尝试点击或绕过人机验证。
 */
export async function waitForCloudflareChallengeResolution(
  page: Page,
  timeout = DEFAULT_RESOLUTION_TIMEOUT_MS,
): Promise<CloudflareChallengeResolution> {
  if (!(await inspectCloudflareChallenge(page))) {
    return "not-detected";
  }

  const deadline = Date.now() + Math.max(timeout, 0);

  while (Date.now() < deadline && !page.isClosed()) {
    await page.waitForTimeout(POLL_INTERVAL_MS);

    if (!(await inspectCloudflareChallenge(page))) {
      await page
        .waitForLoadState("domcontentloaded", { timeout: 5000 })
        .catch(() => {});
      return "resolved";
    }
  }

  return (await inspectCloudflareChallenge(page)) ? "blocked" : "resolved";
}
