/**
 * 随机工具函数
 * 用于实现不定时策略：jitter、随机语言、随机 viewport
 */

/**
 * 生成随机延迟（jitter）- 参考模板版本
 * @param maxMs 最大延迟毫秒数，默认 3000ms
 */
export function jitterMs(maxMs = 3000): number {
  return Math.floor(Math.random() * maxMs);
}

/**
 * 生成随机延迟（jitter）- 兼容旧接口
 */
export function randomJitter(maxMs = 3000): number {
  return jitterMs(maxMs);
}

/**
 * 等待随机时间
 */
export async function waitRandom(maxMs = 3000): Promise<void> {
  const delay = jitterMs(maxMs);
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 从数组中随机选择一个元素
 */
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 随机 Accept-Language（参考模板使用 LOCALES）
 */
export const LOCALES = [
  'en-US,en;q=0.9',
  'en-GB,en;q=0.9',
  'en-CA,en;q=0.9',
  'en-AU,en;q=0.9',
  'ja-JP,ja;q=0.9',
  'de-DE,de;q=0.9',
  'fr-FR,fr;q=0.9',
  'es-ES,es;q=0.9',
];

/**
 * 兼容旧接口
 */
export const ACCEPT_LANGUAGES = LOCALES;

/**
 * 随机 Accept-Language
 */
export function getRandomLanguage(): string {
  return pick(LOCALES);
}

/**
 * 随机 User-Agent（可选，用于更真实的模拟）
 */
export function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

