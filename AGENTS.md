# AGENTS.md

## 项目定位

这是一个基于 `Playwright + TypeScript` 的 Blacklyte 店铺合成监控仓库，不是普通的演示型 `E2E` 项目。这个仓库的核心目标，是在多区域、多设备下模拟真实用户关键路径，尽早发现回归，并在失败时保留足够完整的证据，方便后续排查。

这个仓库最重要的项目级特点如下：

- 多区域执行是第一等公民，区域来源于环境变量 `TARGET`，定义集中在 `src/config/targets.ts`。
- 多设备覆盖由 `playwright.config.ts` 里的 `projects` 统一管理，不要在每个测试里各写各的 viewport。
- 公共能力已经抽到了 `popup`、`jumpPopup`、`network`、`har`、`vitals`、`random` 等工具里，优先复用，不要重复造轮子。
- Journey 的目标不是“跑通一次”，而是“尽量少误报地稳定监控”。断言、选择器和证据采集都要偏稳健。
- 结算链路只验证“能到 checkout”，不做真实支付。
- 失败证据非常重要。全局配置已经保留 `trace`、`screenshot`、`video`，部分关键 Journey 还会额外挂 `HAR`、`console logs`、`HTML`、`Web Vitals`。

## 技术栈与运行基线

- 语言：`TypeScript`
- 类型策略：`strict: true`
- 测试框架：`@playwright/test`
- 模块系统：`ESM`
- 路径别名：`@/* -> src/*`
- 当前 Playwright 项目：
  - `desktop-chromium`
  - `mobile-iphone`
  - `mobile-android`
- 当前 CI 行为：
  - `fullyParallel: true`
  - `retries = 2`（仅 `CI`）
  - `workers = 1`（仅 `CI`）

## 目录职责

- `src/config/targets.ts`
  - 区域、域名、推荐的 Checkly runner location 的唯一事实来源。
- `src/config/vitals_thresholds.ts`
  - `P0 / P1 / P2` 的 Web Vitals 阈值来源。
- `src/config/campaigns.ts`
  - 活动页监控配置来源，适合到期自动降级或跳过的页面。
- `src/utils/popup.ts`
  - 通用营销弹窗关闭逻辑。
- `src/utils/jumpPopup.ts`
  - 跳转类 / 拦截类弹窗关闭逻辑。
- `src/utils/network.ts`
  - 网络摘要采集与附件能力。
- `src/utils/har.ts`
  - `HAR` 风格网络证据导出能力。
- `src/utils/vitals.ts`
  - Web Vitals 注入、读取、校验能力。
- `src/utils/random.ts`
  - `jitter`、随机 `Accept-Language` 等辅助能力。
- `src/journeys/*.spec.ts`
  - 正式 Journey 测试文件，新增或维护功能时主要改这里。
- `src/journeys/*.temp`
  - 模板或草稿，只能当参考，不能当正式测试完成品。
- `playwright-report/`、`test-results/`
  - 生成产物，不要手改。
- `.checkly.example.yml`
  - Checkly 配置样例，不是线上配置真身。

## 测试编写约定

### 命名约定

- 文件名使用优先级加语义名称，例如：
  - `p0_home.spec.ts`
  - `p0_cart_to_checkout.spec.ts`
  - `p1_region_switch.spec.ts`
- `test.describe(...)` 名称应包含优先级和中文语义说明。
- `P0` 表示交易关键路径或监控关键路径。
- `P1` 表示重要但相对次一级的体验或辅助路径。

### 区域约定

- 普通 Journey 不要硬编码区域 URL。
- 常规场景优先使用 `getCurrentTarget()`。
- 只有像 Region Switch 这种天然涉及多个区域的场景，才直接使用 `TARGETS`。
- 默认区域是 `US`，除非显式传入 `TARGET`。

### 设备约定

- 设备覆盖优先走 Playwright `projects`。
- 只有当移动端与桌面端的 DOM 或流程明显不同，才在测试里根据 `isMobile` 分支。
- 不要随手在新测试里写死 viewport，除非确实无法用现有 `projects` 表达。

### 标准起手式

绝大多数 Journey 都应遵循这个模式：

1. 在导航前注入 Web Vitals collector。
2. 打开当前 `target.url`。
3. 关闭 `jumpPopup`。
4. 关闭通用营销弹窗。
5. 执行 Journey 核心流程。
6. 至少附加 `network-summary`。

除非这个任务明确要求重构测试基建，否则新增 Journey 尽量贴合现有模式，不要自创一套起手式。

### 选择器优先级

模板文件已经写明了这个仓库认可的优先级：

1. `getByRole(...)`
2. 稳定文本匹配
3. `href` / URL 相关定位
4. `aria-*` / `data-*`
5. CSS 作为兜底

落地规则：

- 优先选“用户语义稳定”的元素，不要迷恋样式类名。
- 可以合理使用 `.or(...)`、多选择器兜底、`filter({ hasText })` 这种弹性写法。
- 当页面结构允许时，不要把断言绑死在营销文案上。
- 如果同一目标元素在不同设备上结构不同，优先分支处理，不要强凑一个脆弱大选择器。

### 断言风格

- 每个 Journey 都必须有“最低成功断言”，不能只做到“点击没报错就算成功”。
- 优先断言结果，不要只断言过程。
- 允许一个动作存在多种成功路径时，要用弹性断言。
  - 例如加购后，可能跳转 `/cart`，也可能更新 cart count，或者弹出 cart drawer。
- 避免依赖价格、库存、促销文案、折扣数字这类高波动内容。
- Checkout Journey 只断言到达 checkout 并看到核心表单或标题，不进入支付。

### 证据采集

普通 Journey 的最低要求：

- 必须附加 `network-summary`

更高价值的证据，适用于关键 `P0` 或复杂排障：

- `HAR`
- `console logs`
- `console errors`
- `failed requests`
- `Web Vitals`
- 最终截图
- 最终页面 `HTML`

如果你修改的是交易关键路径，宁可多保留点证据，也别省那仨 token。

### 弹窗处理

- 通用弹窗关闭逻辑统一放在 `src/utils/popup.ts`
- 跳转类弹窗统一放在 `src/utils/jumpPopup.ts`
- 新 Journey 应该复用现有 helper，而不是每个文件里自己写一段关闭逻辑
- 如果发现新弹窗模式，优先扩展公共工具，不要在单个 Journey 里偷偷补丁式处理

### Web Vitals 约定

- 必须在页面导航前注入 collector。
- 读取时机应在页面稳定后，必要时在一次真实交互之后。
- 当前仓库里 `LCP`、`CLS` 更适合做稳定记录或阈值判断。
- `INP` 目前更偏“观测指标”，不要随便改成强失败。
- 阈值统一来自 `src/config/vitals_thresholds.ts`。

### 随机化约定

- `src/utils/random.ts` 提供了 `jitter` 和随机 `Accept-Language`。
- 这些能力是“可选增强”，不是“必须全加”。
- 如果某个 Journey 因随机化变得不稳定，应优先收紧或移除随机因素，不要拿“更真实”给不稳定打掩护。

## 常用命令

安装依赖：

```bash
npm install
```

安装 Playwright 浏览器：

```bash
npx playwright install
```

运行全部测试：

```bash
npm test
```

运行 UI 模式：

```bash
npm run test:ui
```

运行 Debug 模式：

```bash
npm run test:debug
```

有头模式运行：

```bash
npm run test:headed
```

查看报告：

```bash
npm run test:report
```

运行单个桌面 Journey：

```bash
npx playwright test src/journeys/p0_home.spec.ts --project=desktop-chromium
```

在 PowerShell 下指定区域运行：

```powershell
$env:TARGET = 'JP'
npx playwright test src/journeys/p1_region_switch.spec.ts --project=desktop-chromium
```

在 POSIX shell 下指定区域运行：

```bash
TARGET=JP npx playwright test src/journeys/p1_region_switch.spec.ts --project=desktop-chromium
```

执行类型检查：

```bash
npx tsc --noEmit
```

## 修改代码时的规则

- 优先做小而准的改动，除非任务明确要求大范围重构。
- 能复用现有工具就复用，别同功能写三套。
- 涉及弹窗、证据采集、Vitals 之类共享逻辑时，优先改 `src/utils/`，不要复制粘贴到多个 Journey。
- 兼容性别名如果已经存在，不要随手删名改名。
- 不要把现在这种“弹性成功判断”粗暴简化成单一路径断言，今天站点能过，不代表下周营销改版还过。
- 不要改生成目录里的文件。
- 不要把 `.checkly.example.yml` 当成真实线上配置去塞密钥。

## 新增 Journey 的最小流程

1. 从 `src/journeys/__TEMPLATE__.spec.ts.temp` 或 `src/journeys/__TEMPLATE_MOBILE__.spec.ts.temp` 起步。
2. 重命名为正式 `.spec.ts` 文件，并遵循 `p0_*` / `p1_*` 规则。
3. 常规场景使用 `getCurrentTarget()`。
4. 导航前注入 Web Vitals。
5. 导航后按需关闭 `jumpPopup` 和通用弹窗。
6. 编写最小成功断言。
7. 附加 `network-summary`。
8. 如果是关键 `P0`，补齐更丰富的证据采集。
9. 至少在一个桌面项目下验证。
10. 如果移动端流程不同，再补一个移动端项目验证。
11. 如果场景受区域影响，至少跑一个非 `US` 区域。

## Review Checklist

提交前至少确认这些事：

- 测试仍然遵守 `TARGET` 机制
- 流程在目标 `project` 上可运行
- 弹窗逻辑没有重复造轮子
- 断言偏结果而不是偏过程
- 没有依赖高波动营销文案
- 已附加 `network-summary`
- 对关键链路保留了足够证据
- 选择器选择基于稳定性，不是基于偷懒
- 至少运行了受影响的 Journey，或者明确说明为什么没跑

## 当前仓库基线提醒

不要默认这个仓库当前是“全绿无警报”的完美状态。

在生成本文件时，已确认：

- `npx tsc --noEmit` 会失败
- 失败位置在 `src/utils/vitals.ts`
- 失败原因主要是 `window.__vitals` 的类型声明缺失，以及 `PerformanceObserverInit.durationThreshold` 类型不兼容
- 当前仓库里有多份 `.temp` 模板 / 草稿文件，不是正式活跃测试

这意味着：

- 你做完改动后跑全量 `tsc`，如果只报上面这些已知错误，不要第一时间怀疑是自己把锅炖糊了
- 但如果你正好修改了 `src/utils/vitals.ts`，最好顺手把那块基线问题一起收拾掉

## 编码与文件卫生

- 默认保持 `UTF-8`
- 如果原文件是 `UTF-8 with BOM`，必须保留 `BOM`
- 保持原有换行风格，不要无意义改整文件行尾
- 仓库里存在中文注释和文本，编辑时要特别注意编码不要被搞坏
- 如果出现像 `Unterminated string constant` 这类邪门解析错误，先检查编码和换行，别上来就怀疑人生

## 当文档与代码冲突时

- 以实现为准
- 优先相信 `playwright.config.ts`、`src/config/*.ts`、活跃的 `src/journeys/*.spec.ts`
- `README` 和样例配置如果与代码不一致，应更新文档或在交付说明里明确指出漂移点
