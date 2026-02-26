/**
 * 全球站点配置
 * 6 个 Region 站点映射
 */
export type Region = 'US' | 'CA' | 'EU' | 'UK' | 'AU' | 'JP';
export type TargetKey = Region; // 类型别名，兼容参考模板

export interface TargetConfig {
  region: Region;
  url: string;
  checklyLocation?: string; // Checkly Runner Location 建议
}

export const TARGETS: Record<TargetKey, TargetConfig> = {
  US: {
    region: 'US',
    url: 'https://blacklyte.com/',
    checklyLocation: 'us-east-1',
  },
  CA: {
    region: 'CA',
    url: 'https://blacklyte.ca/',
    checklyLocation: 'us-east-1',
  },
  EU: {
    region: 'EU',
    url: 'https://blacklyte.eu/',
    checklyLocation: 'eu-central-1',
  },
  UK: {
    region: 'UK',
    url: 'https://goblacklyte.uk/',
    checklyLocation: 'eu-west-2',
  },
  AU: {
    region: 'AU',
    url: 'https://blacklyte.au/',
    checklyLocation: 'ap-southeast-2',
  },
  JP: {
    region: 'JP',
    url: 'https://blacklyte.jp/',
    checklyLocation: 'ap-northeast-1',
  },
};

/**
 * 获取当前目标站点（从环境变量 TARGET 读取）
 */
export function getCurrentTarget(): TargetConfig {
  const target = (process.env.TARGET || 'US').toUpperCase() as Region;
  return TARGETS[target] || TARGETS.US;
}

/**
 * 获取所有目标站点
 */
export function getAllTargets(): TargetConfig[] {
  return Object.values(TARGETS);
}

