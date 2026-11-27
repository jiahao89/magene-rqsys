# RQ-Sys Web Design System（Arco Design · 目标 B）

> **设计基线：原生 Arco Design（`@arco-design/web-react`，ADR-002 目标 B，2026-11-26 批准）。**
> 本文是 `apps/web` 与 `rq-sys-miaoda/client` 的统一视觉与交互规范。历史 HeroUI v3 配色、模板与导入约定已全部废止；HeroUI 与 Radix 原语在两端均禁止引入。

**技术栈：** React 19 + Arco Design（`@arco-design/web-react`）｜**主题模式：** Light / Dark（由 `body[arco-theme]` 原生驱动）｜**视觉基调：** 清爽、克制、高信息密度的企业级控制台，以 Arco 中性灰画布与白色卡片建立清晰层级，以单一 Arco Blue（`#165DFF`）表达主操作。

---

## 1. 设计原则

1. **原生 Arco 优先，禁止重复造轮子。** 布局外壳、卡片、提示、标签、页签、表单、表格、空态、骨架屏、弹层一律优先使用 Arco 原生组件与内置属性，不手写等价 HTML/CSS 控件，不用 `!important` 把 Arco 控件改回旧皮肤。
2. **先表达语义，再使用颜色。** 统一消费 Arco 语义 token（`--color-text-*`、`--color-bg-*`、`--color-fill-*`、`--color-border-*`、`--primary-6`、`--success-6`、`--warning-6`、`--danger-6`），不在业务样式中散落硬编码 hex。
3. **清晰的操作权重层级。** 同一操作区最多 1 个 `type="primary"` 主按钮；并列/次要操作用 `secondary` 或 `outline`；轻量/行内操作用 `text`；破坏性操作单独使用 `status="danger"` 并经二次确认。
4. **明暗主题零手工维护。** 所有表面、文字、边框与状态色默认跟随 Arco `body[arco-theme="dark"]` 自动切换，不编写成批 `html[data-theme="dark"]` 硬编码覆写。
5. **交互与无障碍完整。** 所有操作键盘可达，焦点环清晰可见；状态不只依赖颜色（必须配中文文字或图标）；遵循 `prefers-reduced-motion`。

---

## 2. 颜色系统与暗色模式

基础 token 由 `@arco-design/web-react/es/style/index.css` 全局提供，业务样式直接引用 Arco CSS 变量：

| 语义角色 | Arco CSS 变量 | Light 默认值 | 使用场景 |
|---|---|---|---|
| 页面画布底色 | `var(--color-fill-2)` | `#F2F3F5` | `Layout.Content` 主工作区背景，使白色卡片自然分层 |
| 内容卡片 / 侧栏 / 顶栏 | `var(--color-bg-2)` | `#FFFFFF` | `Card`、`Layout.Sider`、`Layout.Header` |
| 浮层 / 弹层背景 | `var(--color-bg-popup)` | `#FFFFFF` | `Modal`、`Drawer`、`Popover`、`Dropdown`、`Select` 菜单 |
| 次级表面 / 表格头 / 悬停 | `var(--color-fill-1)` / `var(--color-fill-2)` | `#F7F8FA` / `#F2F3F5` | 嵌套信息块、筛选条底色、行悬停 |
| 常规边框 / 细分隔线 | `var(--color-border-2)` / `var(--color-border-1)` | `#E5E6EB` / `#F2F3F5` | 卡片描边、区域分隔、表格线 |
| 文字主 / 次 / 辅 / 禁用 | `var(--color-text-1)` ~ `var(--color-text-4)` | `#1D2129` / `#4E5969` / `#86909C` / `#C9CDD4` | 标题与正文 / 次要说明 / 辅助元信息 / 禁用与占位 |
| 品牌主色（Arco Blue） | `rgb(var(--primary-6))` / 浅底 `rgb(var(--primary-1))` | `#165DFF` / `#E8F3FF` | 主按钮、选中菜单、链接、焦点态 |
| 成功语义 | `rgb(var(--success-6))` / 浅底 `rgb(var(--success-1))` | `#00B42A` / `#E8FFEA` | 已推送、已分析、验收通过 |
| 警告语义 | `rgb(var(--warning-6))` / 浅底 `rgb(var(--warning-1))` | `#FF7D00` / `#FFF7E8` | 待分配负责人、暂缓、待处理、P1 |
| 危险语义 | `rgb(var(--danger-6))` / 浅底 `rgb(var(--danger-1))` | `#F53F3F` / `#FFECE8` | 推送失败、安全阻断、删除确认、P0 |

### 业务专属色（仅限极少量领域标识）

需求来源竖色条（PRD §4.9.3）直接基于 Arco 标准色阶派生，自动适配亮/暗模式：

- **多维表格（`base_form`）**：`rgb(var(--arcoblue-6))`
- **Web 手工（`web_manual`）**：`rgb(var(--orange-6))`
- **聊天粘贴（`chat_paste`）**：`rgb(var(--purple-6))`
- **Teambition（`teambition`）**：默认来源，不加行首色条。

### 主题切换机制

- 亮/暗切换仅通过 `document.body.setAttribute("arco-theme", "dark")`（暗色）或移除该属性 / 设为 `"light"`（亮色）完成；`<html data-theme>` 仅作兼容保留，不再作为样式覆写选择器。
- 原生 `<input type="datetime-local">` 同步跟随 `color-scheme: light | dark`。

---

## 3. 字体、圆角与间距体系

### 排版规范

- **字体栈**：沿用 Arco 系统无衬线字体栈（`Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`）；ID、代码与公式使用等宽字体（`ui-monospace, SFMono-Regular, Menlo, monospace`）。
- **四档字号**（禁止使用 `12.5px`、`17px`、`19px`、`23px` 等随意像素值）：
  - **页面标题**：`20px` / `font-weight: 600` / `line-height: 1.4`
  - **区块 / 卡片标题**：`16px` / `font-weight: 500` / `line-height: 1.5`
  - **正文与表格内容**：`14px` / `font-weight: 400` / `line-height: 1.57`
  - **辅助说明 / 标签 / 表格辅助列**：`12px` / `font-weight: 400` / `line-height: 1.5`
- **字重约束**：全站仅允许 `400`（常规）、`500`（中等标题/强调）、`600`（主标题/KPI 数值），禁止使用 `560`、`620`、`760` 等非标准字重。
- **数字对齐**：KPI、统计数值、表格计数与版本号一律启用 `font-variant-numeric: tabular-nums`。

### 圆角与间距规范

- **三档圆角**（严禁混用 `5px`/`7px`/`9px`/`10px`/`14px`/`16px`）：
  - `var(--border-radius-small)`（`2px`）：紧凑标签、小型内嵌徽标
  - `var(--border-radius-medium)`（`4px`）：按钮、输入框、下拉框、菜单项、表格容器
  - `var(--border-radius-large)`（`8px`）：`Card`、信息面板、`Modal`
- **4px 间距栅格**：常用步长 `4 / 8 / 12 / 16 / 20 / 24px`；页面主内容区内边距 `20px 24px`；卡片间距 `16px`；工具栏控件间距 `8px` / `12px`（优先用 Arco `Space` 与 `Grid` 控制）。
- **阴影策略**：普通卡片使用 `1px solid var(--color-border-2)` + 无阴影（扁平清晰）；阴影仅留给 Arco 内置浮层（`Popover` / `Dropdown` / `Modal` / `Drawer`）。

---

## 4. 布局骨架与导航

两端统一使用原生 Arco `Layout` 骨架，消除根仓与妙搭的外壳差异：

- **外层骨架**：`<Layout>` 包含左侧 `<Layout.Sider width={240}>` + 右侧 `<Layout>`（`<Layout.Header>` + `<Layout.Content>`）。
- **侧栏导航**：使用 `<Menu>` + `<Menu.ItemGroup>` + `<Menu.Item>`，选中态、悬停态、图标间距均由 Arco 原生样式提供；禁止手写 `<a class="nav-item">` 或 `.rq-nav-menu !important` 强行改写。
- **顶部栏**：左侧 `<Breadcrumb>` 表达当前位置，右侧通过 `<Space>` + `<Divider type="vertical" />` 排列连接状态 `<Tag>` / `<Badge>`、主题切换与用户头像。
- **移动端适配（≤860px）**：使用 Arco `<Drawer placement="left">` 承载侧栏菜单，由组件库原生管理遮罩、滚动锁、Escape 关闭与焦点捕获；不再手写 `.sidebar-backdrop` 按钮或自定义键盘焦点陷阱。

---

## 5. 按钮优先级与操作层级

| 视觉权重 | Arco Button 属性 | 使用场景 |
|---|---|---|
| 主操作 | `type="primary"` | 当前屏/表单唯一最重要的正向动作（如「提交需求」「分配负责人」「立即同步」） |
| 次操作 | `type="secondary"` | 与主操作并列的常用动作（如「重新分析」「重试推送」「导出 CSV」） |
| 边框次要 | `type="outline"` | 需要明确边界的辅助动作（如「复制提示词」「恢复默认」） |
| 轻量/行内 | `type="text"` | 表格行内操作、取消、返回、展开/收起、页内跳转 |
| 危险操作 | `status="danger"`（搭配 `primary` / `outline` / `text`） | 删除、清空负责人、撤销绑定等破坏性操作；执行前必须经过 `ConfirmModal` |
| 纯图标按钮 | `type="text" shape="circle" icon={...}` | 顶栏工具按钮、关闭按钮；必须提供 `aria-label` 与 `Tooltip` |

> 禁止把 `Button` 伪装成多行 KPI 卡片、筛选胶囊、遮罩层或列表整行容器——对应场景应分别使用 `Card hoverable`、`Tag checkable`、`Drawer` 与 `Table onRow`。

---

## 6. 组件选型映射表

| 业务用途 | 标准 Arco 组件 | 规范与备注 |
|---|---|---|
| 页面骨架 / 移动端抽屉 | `Layout`（`Sider`/`Header`/`Content`）、`Drawer` | 统一两仓导航外壳 |
| 导航与位置 | `Menu`、`Breadcrumb`、`Divider` | `Menu.ItemGroup` 组织分组 |
| 内容容器与分区 | `Card`（`title` / `extra`） | 替代手写 `.panel` 与 `.req-section` |
| 键值对元信息 | `Descriptions` | 替代手写 `<dl>` 网格 |
| 数据列表 / 评分表 | `Table`（`pagination={false}`） | 列表沿用游标「加载更多」；同列多字段须写唯一 `key` |
| 指标与进度 | `Statistic`、`Progress` | 替代手写 KPI 卡与 `.progress-track` |
| 状态徽标与计数 | `Tag`、`Badge` | `Tag` 承载业务状态/优先级/来源；`Tag checkable` 用于人群选择；`Tag closable` 用于执行人白名单；`Badge status` 用于状态圆点 |
| 横幅与短时反馈 | `Alert`、`Message` | `Alert` 替代 `.alert-banner`/`.notice-banner`；`Message` 承载复制/保存/还原等短时提示 |
| 页签与分段切换 | `Tabs`、`Radio.Group type="button"` | 替代手写 `.source-tabs`、池切换、重复视图切换、时间窗口切换 |
| 折叠与浮层筛选 | `Collapse`、`Popover`、`Tooltip` | 替代 `<details class="fold">`、手写 `.qmore-body` 浮层与裸 `title` 属性 |
| 表单与控件 | `Form`/`Form.Item`、`Input`、`Input.TextArea`、`InputNumber`、`Select`、`Checkbox`、`Switch` | 开关类配置（如启用同步/周计划）用 `Switch`；校验错误贴近字段展示 |
| 空态 / 加载 / 异常页 | `Empty`、`Skeleton`、`Result` | 替代手写 `.empty-state`、`.skeleton-*` 与错误边界静态块 |
| 破坏性确认 | `ConfirmModal`（`confirm-modal.tsx`） | 封装 Arco `Modal`，打开后设置 `role="alertdialog"` 与 `aria-describedby` |
| 键盘可达下拉菜单 | `AdvancedActions` | 封装受控 `Dropdown` + `Menu`，保证 `aria-haspopup`/`aria-expanded`/焦点与 `Esc` 行为 |

### 明确豁免

1. **ARCO-04 日期时间筛选**：6 处 `datetime-local` 保留原生 `<input type="datetime-local">`（放在 `Form.Item` 内，避免 `dayjs`/时区回归），边框与背景复用 Arco token。
2. **原生链接 `<a>`**：需浏览器原生跳转/深链分享处保留 `<a>` 或使用 Arco `Link`。

---

## 7. 交互状态、动效与无障碍规则

- **完整状态覆盖**：所有可交互控件与页面必须清晰呈现 Default、Hover、Focus-Visible、Selected/Active、Disabled、Loading、Error、Empty 状态。
- **状态不只靠颜色**：状态标签一律**中文呈现、英文原值放 `title` 或 `Tooltip`**，并辅以图标或文字区分，满足 WCAG AA 对比度。
- **动效节制**：使用 Arco 默认过渡动画，不额外叠加自定义弹跳/缩放动效；遵循 `@media (prefers-reduced-motion: reduce)`。
- **键盘与辅助技术**：所有操作支持键盘操作；表单错误与字段关联；异步刷新与通知使用恰当的 `role="status"` / `role="alert"`。

---

## 8. 页面信息架构：列表与详情分离

> 沿用 2026-10-20 确认的信息架构。列表只负责扫描与筛选，详情独立页面承载阅读与决策，**禁止列表行内展开**。

### 8.1 列表页（需求池 / 集团需求池 / 我的需求 / 回收站）

- **单行四问**：一行清晰回答「这是什么（标题 + 平台 ID + 来源徽标）」「归谁（负责人）」「到哪一步（四阶段状态 Tag）」「要不要我处理（优先级/更新时间）」。
- **点击整行进详情**：深链为 `?requirement=<id>`（集团池按详情 `pool` 自动守卫，显式跨池返回 404）；返回列表保留筛选条件与分页状态。
- **行内操作克制**：常规行不堆叠操作按钮；高频待分配负责人或回收站还原入口保持明确且单列对齐。
- **默认排序**：待人工处理优先（待分配负责人 > 推送失败 > 待推送 > 已推送），同组按更新时间倒序；切换优先级分诊排序后按生效优先级 P0→P3 展示。

### 8.2 详情页

- 独立页面，顶部提供返回导航与**摘要区**（标题完整换行、负责人、生效优先级评分卡、四阶段状态、`primary` 主操作与次要操作按钮）。
- 下方按信息分层自上而下展开，区与区之间使用 `Card` 间距或 `Divider` 清晰分隔，避免多层嵌套卡片。

---

## 9. 需求详情的信息架构（L1 / L2 / L3）

一条需求在详情页按「用户是否需要立刻据此行动」分为三层，**L1 首屏清晰可见**：

| 层级 | 内容 | 展示形态 |
|---|---|---|
| **L1 决策必需** | 需求标题、需求描述（默认最多 6 行 + 展开）、负责人 + 分配/变更入口、四阶段状态、来源说明（「这条需求怎么来的」） | 摘要 `Card` + 需求信息 `Card`（`Descriptions` + 正文段落） |
| **L2 决策辅助（AI）** | 综合评分与优先级（九项输入 + α + 公式 + 人工改分）、模块/人群建议（PM 确认）、人工优先级覆盖与补充上下文、按需「需求评估 + Investigation 提示词」、按需「PRD 提示词」、可选 RICE / Kano Beta | 独立 `Card` 分块；AI 建议与人工确认明确区分 |
| **L3 溯源与审计** | 原文证据、事实与 `【AI 推断】`、缺失信息、分析盲点、源快照、分析版本历史、Base 记录号与链接、重复处理 | 默认收起的 Arco `Collapse`（「查看依据与历史」），避免淹没 L1/L2 |

### 9.1 数据归属标注

详情分区标题右侧用 Arco `Tag` 明确标注数据归属：

- **需求信息**：`来自 Teambition` / `Web 手工` / `聊天粘贴` / `多维表格`（非 TB 需求隐藏 TB 专属字段）
- **AI 分析与建议**：`AI 生成 · 可被推翻`
- **处理与推送**：`系统状态`

### 9.2 人工优先级覆盖与补充上下文（V02-T26）

- **人工优先级**：置于「AI 评分与优先级」下方，独立展示当前生效优先级及来源（人工覆盖 / 当前评分版本）；只影响应用内列表/详情/总览，**不回写 Base**。
- **补充上下文**：多行 `Input.TextArea` + 「保存」/「保存并重新分析」；以下一次模型请求独立段提供，不写入 Base，不改写来源事实。
- 已压制（重复/忽略）或已逻辑删除需求隐藏/禁用写入口（服务端返回 `409`）。

### 9.3 空态与缺失值

- 无 AI 分析结果：使用 `Empty` + 「触发分析」按钮，不渲染空表格。
- 无负责人：`Tag color="orange"` 标示「待分配」，旁边提供「分配负责人」入口。
- 源端字段为空：显示 `—` 并通过 `Tooltip` 说明来源未提供，不留空白。

---

## 10. 双仓样式表、导入顺序与防回归约定

| 项目 | `apps/web` | `rq-sys-miaoda/client`（线上） |
|---|---|---|
| 组件库 | `@arco-design/web-react`（直接导入，退役 `arco.tsx`） | `@arco-design/web-react`（同版本，直接导入） |
| React 19 适配器 | 入口引入 `@arco-design/web-react/es/_util/react-19-adapter` | 同左 |
| CSS 导入顺序 | **先** `./arco-styles`，**后** `./styles.css` | **先** `./rqsys/arco-styles`，**后** `./rqsys/styles.css`（严禁倒置） |
| 按需样式注册 | `apps/web/src/arco-styles.ts` | `rq-sys-miaoda/client/src/rqsys/arco-styles.ts` |
| Tailwind 定位 | 仅 preflight/reset（TSX 中 0 工具类，ARCO-14） | 同左；清理未使用的 `typography.css`、`tw-animate-css` 与废弃 shadcn 变量 |
| 禁止项 | 禁止 HeroUI、禁止 `.arco-* !important`、禁止规则内硬编码 hex | 同左，同时禁止引入 Radix 业务控件 |

### 自动化门禁

1. **`npm run check:arco-styles`**：校验两端源码用到的所有 Arco 组件均已在 `arco-styles.ts` 中登记 `style/css.js`（以及基础 `@arco-design/web-react/es/style/index.css`）。
2. **`npm run check:alignment`**：校验两端共享前端模块、`arco-styles.ts` 与 `styles.css` 无未声明漂移。
3. **两仓一致性**：`apps/web` 与 `rq-sys-miaoda/client` 的视觉样式、布局结构与交互行为保持一致，同步样式时通过共享基线维护，禁止单边漂移或误删平台必要规则。

---

## 11. 页面设计检查清单

- [ ] 页面画布使用 `var(--color-fill-2)`，卡片/侧栏/顶栏使用 `var(--color-bg-2)`，圆角仅用 `2px / 4px / 8px`。
- [ ] 全页无新增硬编码 hex，无 `.arco-* !important` 覆盖；暗色模式仅依赖 `body[arco-theme="dark"]` 自动生效。
- [ ] 同一操作区域至多 1 个 `type="primary"` 按钮；破坏性操作使用 `status="danger"` 并走 `ConfirmModal`。
- [ ] 布局、卡片、表单、提示、标签、页签、空态、加载均使用原生 Arco 组件（仅 ARCO-04 `datetime-local` 与原生 `<a>` 例外）。
- [ ] 新增 Arco 组件已同步登记至两端 `arco-styles.ts` 且 `npm run check:arco-styles` 通过。
- [ ] 所有纯图标按钮带 `aria-label` 与 `Tooltip`，键盘导航与焦点可见。
