# Blacklyte 全球合成监控（Synthetic Monitoring）

方案：Checkly（全球节点） + Playwright（真实用户旅程）

目标：不定时模拟全球不同国家用户访问站点并完成关键操作，及时发现 bug，失败可复现、证据完整、告警可行动。

## 项目结构

```
synthetic-blacklyte/
├── package.json
├── tsconfig.json
├── playwright.config.ts
├── README.md
└── src/
    ├── config/
    │   ├── targets.ts          # 6 个 Region 站点配置
    │   ├── campaigns.ts        # 活动页配置（自动过期）
    │   └── vitals_thresholds.ts # Web Vitals 阈值
    ├── utils/
    │   ├── popup.ts            # 统一关闭营销弹窗
    │   ├── network.ts          # 网络摘要收集
    │   ├── random.ts           # 随机工具（jitter、语言等）
    │   └── vitals.ts           # Web Vitals 采集
    └── journeys/
        ├── p0_home.spec.ts              # P0: 首页核心功能
        ├── p0_collection.spec.ts        # P0: 分类页列表
        ├── p0_pdp_add_to_cart.spec.ts   # P0: 商品加购
        ├── p0_cart_to_checkout.spec.ts  # P0: 购物车到结算
        ├── p1_search.spec.ts            # P1: 搜索功能
        ├── p1_region_switch.spec.ts     # P1: 区域切换
        ├── p0_campaign_template.spec.ts  # 活动页模板
        ├── __TEMPLATE__.spec.ts         # 通用模板
        └── __TEMPLATE_MOBILE__.spec.ts  # 移动端模板
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 安装 Playwright 浏览器

```bash
npx playwright install
```

这将下载 Chromium、Firefox 和 WebKit 浏览器，用于运行测试。

### 本地运行

```bash
# 运行所有测试
npm test

# 运行特定 Region 的测试
TARGET=US npx playwright test src/journeys/p0_home.spec.ts
TARGET=JP npx playwright test src/journeys/p1_region_switch.spec.ts

# 运行完整用户旅程（推荐，覆盖所有关键操作）
TARGET=US npx playwright test src/journeys/p0_complete_user_journey.spec.ts

# 运行特定设备
npx playwright test --project=desktop-chromium
npx playwright test --project=mobile-iphone

# 调试模式
npm run test:debug

# UI 模式
npm run test:ui
```

## 覆盖站点（6 个 Region）

- **US**: https://blacklyte.com/
- **CA**: https://blacklyte.ca/
- **EU**: https://blacklyte.eu/
- **UK**: https://goblacklyte.uk/
- **AU**: https://blacklyte.au/
- **JP**: https://blacklyte.jp/

## 旅程清单

### P0（核心成交链路）

1. **P0_HOME**: 打开首页 -> 关闭弹窗 -> 验证核心导航/首屏可用
2. **P0_COLLECTION**: 进入分类页（Chairs/Desks/Accessories）-> 列表加载
3. **P0_PDP_ADD_TO_CART**: 商品详情页 -> Add to Cart -> cart 状态变化
4. **P0_CART_TO_CHECKOUT**: cart -> checkout 前一步（不需要支付）
5. **P0_COMPLETE_USER_JOURNEY**: 完整用户旅程（首页→搜索→详情→加购→结算→登录/订阅→切换地区→下载页）⭐ **推荐**

### P1（体验/增长常见问题）

6. **P1_SEARCH**: 搜索 Athena/Atlas -> 结果出现 -> 进入 PDP
7. **P1_REGION_SWITCH**: Regions 切换到另一个站点 -> URL/区域标识正确

## 核心功能

### 1. 统一关闭营销弹窗

所有旅程自动关闭营销弹窗，支持多种关闭方式：
- 点击 Close 按钮
- 点击 "No, subscribe later"
- 按 Escape 键
- 点击遮罩层

### 2. 网络摘要收集

自动收集并附加到测试报告：
- 失败请求（requestfailed）
- 错误响应（status >= 400）
- 慢请求（> 4s）

### 3. Web Vitals 监控

**原则与现实约束：**
- **LCP / CLS**：可在页面加载期间用 PerformanceObserver 采集，稳定可用
- **INP**：必须有真实交互（点击/输入）才有意义；合成监控里建议在关键交互后采集 INP，并设相对宽松阈值

**一次性注入采集脚本（关键：page.addInitScript）：**

```typescript
import { installWebVitalsCollector, readWebVitals } from '../utils/vitals';
import { VITALS_THRESHOLDS } from '../config/vitals_thresholds';

await installWebVitalsCollector(page);
await page.goto(base, { waitUntil: 'domcontentloaded' });
// …关闭弹窗…做一次点击（让 INP 有意义）
await page.getByRole('link', { name: /Products/i }).click().catch(()=>{});

// 等关键元素出现后再读 vitals
const vitals = await readWebVitals(page);
testInfo.attach('web-vitals', { 
  body: JSON.stringify(vitals, null, 2), 
  contentType: 'application/json' 
});

// 断言（P0）
if (vitals.lcp != null) expect(vitals.lcp).toBeLessThan(VITALS_THRESHOLDS.P0.lcp);
if (vitals.cls != null) expect(vitals.cls).toBeLessThan(VITALS_THRESHOLDS.P0.cls);
// INP 先不 hard fail，只在明显回归时报警（避免误报）
```

**阈值配置：**
- P0: LCP < 4000ms, CLS < 0.10, INP < 300ms
- P1: LCP < 6000ms, CLS < 0.15, INP < 500ms

**落地建议：**
1. 先把 vitals 当作 "记录 + 报警附加证据"
2. 稳定两周后再把 LCP/CLS 的阈值改为 hard fail（P0）
3. INP 先不 hard fail，只在明显回归时报警（避免误报）

### 4. Console Error 和日志收集

自动收集：
- **控制台错误**：所有 JavaScript 错误（纯文本格式）
- **控制台日志**：所有控制台输出（info/warn/error，JSON 格式）
- **页面错误**：未捕获的异常
- **失败请求**：所有 HTTP 请求失败

P0 建议将严重的 console errors 作为失败条件。

### 5. 不定时策略

- 随机 jitter（0~3s）
- 随机 Accept-Language
- 多设备覆盖（Desktop、iPhone、Android）

### 6. 完整证据收集（失败时自动）

- **截图**：失败时自动截图（`screenshot: 'only-on-failure'`）
- **录屏**：失败时自动录屏（`video: 'retain-on-failure'`）
- **Trace**：失败时保留 trace（可在 Playwright Inspector 中查看）
- **网络 HAR**：所有网络请求的完整记录
- **控制台日志**：所有控制台输出和错误
- **页面 HTML**：最终 DOM 状态
- **Web Vitals**：性能指标数据

所有证据都会附加到测试报告中，便于问题诊断和复现。

## 设备覆盖

### Mobile 覆盖策略

**推荐做法：Playwright projects**

不要在每个 journey 手写 viewport；统一用 Playwright 的 project，一条脚本跑 desktop + mobile 两套。

```typescript
// playwright.config.ts
projects: [
  // Desktop
  { name: "desktop-chromium", use: { browserName: "chromium" } },
  // iPhone
  { name: "mobile-iphone", use: { ...devices["iPhone 14"], browserName: "chromium" } },
  // Android
  { name: "mobile-android", use: { ...devices["Pixel 7"], browserName: "chromium" } },
]
```

**Mobile Journey 模板特点：**

移动端常见差异：
- header 变成 `button[aria-label="menu"]`（汉堡菜单）
- Cart 文案可能是 "Cart 00 items"
- 搜索 icon 也不同

参考模板：`src/journeys/__TEMPLATE_MOBILE__.spec.ts`

**上线策略：**
- **P0**：desktop + iPhone 必跑；Android 可先作为 P1（降低初期维护成本）
- 等稳定后再把 Android 提升为 P0

### 设备列表

- **Desktop**: Chromium
- **Mobile iPhone**: iPhone 14
- **Mobile Android**: Pixel 7

## Checkly 集成建议

### Locations（Runner）

- US/CA: us-east-1
- EU: eu-central-1
- UK: eu-west-2
- AU: ap-southeast-2
- JP: ap-northeast-1

### 调度（cron 错峰）

每 10 分钟一次，错峰启动：
- US: `*/10 * * * *`
- CA: `2-59/10 * * * *`
- EU: `4-59/10 * * * *`
- UK: `6-59/10 * * * *`
- AU: `8-59/10 * * * *`
- JP: `1-59/10 * * * *`

### Artifacts

- trace: `retain-on-failure`
- screenshot: `only-on-failure`
- video: `retain-on-failure`

### 告警策略

- P0：连续失败 >= 2 次才告警
- P1：连续失败 >= 3 次才告警

## 活动页监控

### 设计目标

活动页上线频繁，且到期后页面可能下线/重定向。需要：
- 快速加一个旅程
- 能在活动结束后自动降级/下线，避免"活动结束导致天天报警"

### "带到期"的配置文件

```typescript
// src/config/campaigns.ts
export const CAMPAIGNS: Campaign[] = [
  { 
    name: "CHRISTMAS_SALE", 
    path: "/collections/christmas-sale", 
    expiresAt: "2026-01-05", 
    tier: "P0" 
  },
  { 
    name: "BLACK_FRIDAY", 
    path: "/collections/black-friday", 
    expiresAt: "2026-12-02", 
    tier: "P0" 
  },
];
```

### 临时旅程模板（自动判断是否过期）

参考模板：`src/journeys/p0_campaign_template.spec.ts`

```typescript
// ✅ 过期后自动 skip（不报警）
if (isExpired(c.expiresAt)) test.skip(true, `campaign expired: ${c.name}`);

// ✅ 最低断言：页面标题/商品列表/Shop Now 按钮出现即可
await expect(
  page.locator('h1').or(page.getByText(/Sale|Christmas|Off/i))
).toBeVisible({ timeout: 20000 });

// ✅ 加一个"活动页常见问题"断言：主按钮可点击
const shopNow = page.getByRole('link', { name: /Shop Now/i }).first();
if (await shopNow.isVisible().catch(() => false)) await shopNow.click();
```

### 上线策略

活动期间设为 P0；到期自动 skip，不影响主监控体系。

## 维护规范（强制）

1. ✅ Journey 必须调用 `popup.close()`
2. ✅ 必须 attach `network-summary`
3. ✅ 必须有"最低成功断言"
4. ✅ selector 优先级：`getByRole` > `text` > `url` > `aria` > `css`
5. ✅ 避免依赖价格/库存/促销文案（改版误报来源）

## 环境变量

- `TARGET`: 指定 Region（US/CA/EU/UK/AU/JP），默认 US
- `BASE_URL`: 覆盖基础 URL（可选）

## 开发指南

### 创建新旅程

1. 复制 `__TEMPLATE__.spec.ts` 或 `__TEMPLATE_MOBILE__.spec.ts`
2. 实现测试步骤
3. 确保调用 `closePopup()` 和 `attachNetworkSummary()`
4. 添加最低成功断言

### 调试技巧

```bash
# 查看测试报告
npm run test:report

# 运行单个测试文件
npx playwright test src/journeys/p0_home.spec.ts --headed

# 调试模式（逐步执行）
npx playwright test --debug
```

## 许可证

MIT
