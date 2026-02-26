/**
 * Web Vitals 阈值配置
 * 合成监控建议阈值先宽松，记录两周后再调整
 */
export interface VitalsThresholds {
  lcp: number; // Largest Contentful Paint (ms)
  cls: number; // Cumulative Layout Shift
  inp: number; // Interaction to Next Paint (ms)
}

export const VITALS_THRESHOLDS: Record<'P0' | 'P1' | 'P2', VitalsThresholds> = {
  P0: {
    lcp: 4000, // 4s
    cls: 0.10,
    inp: 300, // 300ms
  },
  P1: {
    lcp: 5000, // 5s
    cls: 0.15,
    inp: 400, // 400ms
  },
  P2: {
    lcp: 6000, // 6s
    cls: 0.20,
    inp: 500, // 500ms
  },
};

/**
 * 获取指定优先级的阈值
 */
export function getThresholds(priority: 'P0' | 'P1' | 'P2'): VitalsThresholds {
  return VITALS_THRESHOLDS[priority];
}

