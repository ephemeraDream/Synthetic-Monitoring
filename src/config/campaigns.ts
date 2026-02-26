/**
 * 活动页配置（黑五/圣诞等短期活动）
 * 自动过期策略：过期后自动 skip 测试，避免误报
 */
export interface Campaign {
  name: string;
  path: string;
  expiresAt: string; // ISO date 格式，例如 '2026-01-05' 或 '2026-12-31T23:59:59Z'
  tier: 'P0' | 'P1' | 'P2'; // 使用 tier 替代 priority，与参考模板一致
}

export const CAMPAIGNS: Campaign[] = [
  // 示例：圣诞活动
  // {
  //   name: 'CHRISTMAS_SALE',
  //   path: '/collections/christmas-sale',
  //   expiresAt: '2026-01-05',
  //   tier: 'P0',
  // },
  // 示例：黑五活动
  // {
  //   name: 'BLACK_FRIDAY',
  //   path: '/collections/black-friday',
  //   expiresAt: '2026-12-02',
  //   tier: 'P0',
  // },
];

/**
 * 检查活动是否过期
 */
export function isExpired(expiresAt: string): boolean {
  return Date.now() > new Date(expiresAt).getTime();
}

/**
 * 检查活动是否过期（兼容旧接口）
 */
export function isCampaignExpired(campaign: Campaign): boolean {
  return isExpired(campaign.expiresAt);
}

/**
 * 获取有效的活动列表（未过期）
 */
export function getActiveCampaigns(): Campaign[] {
  return CAMPAIGNS.filter(campaign => !isCampaignExpired(campaign));
}

/**
 * 根据路径查找活动
 */
export function findCampaignByPath(path: string): Campaign | undefined {
  return CAMPAIGNS.find(campaign => campaign.path === path);
}

