# HeroUI Web Design System

> 参考 HeroUI v3 与 HeroUI Pro React Web 官方文档整理，作为本项目 Web UI 的设计与实现基线。该文件不是 HeroUI Pro 源码或 Figma 变量的逐项导出；颜色与主题变量以官方当前默认主题为准，尺寸层级和组件使用规则中标为“建议”的部分是为了项目统一而补充的约定。

**范围：** React Web / Tailwind CSS v4 / HeroUI v3 + HeroUI Pro  
**模式：** Light、Dark
**视觉基调：** 清爽、克制、内容优先；用中性表面建立层级，以单一强调色表达主要操作。

## 1. 设计原则

1. **先表达用途，再表达颜色。** 组件使用 `accent`、`success`、`warning`、`danger` 等语义色，不在组件中散落任意品牌色值。
2. **靠表面、间距和层级组织内容。** 页面背景保持安静；卡片、面板和浮层使用不同的 surface 层级，边界线保持低对比。
3. **每个操作有明确优先级。** 同一操作区域最多一个 primary；依次用 secondary、tertiary、ghost 表达较低权重，危险操作单独使用 danger。
4. **组件由组合部件组成。** 对复杂组件保留 Header、Content、Footer 等语义结构，便于局部调整与无障碍标注。
5. **交互状态完整。** hover、pressed、focus-visible、selected、disabled、loading、invalid、empty 均需可辨认；状态不只依赖颜色。
6. **尊重辅助功能设置。** 保留键盘导航与可见焦点；动画响应 `prefers-reduced-motion`；图表和状态还要提供文字、形状或图标线索。

## 2. 视觉语言

HeroUI 默认主题是明亮的中性灰阶界面：接近白色的页面底色、白色内容表面、深灰文字、低对比细分隔线和克制阴影。默认强调色为蓝色系。整体应显得清晰、现代、可用于长时间操作的产品界面，而不是营销页式的大面积渐变和装饰。

HeroUI Pro 支持多个完整主题，因此组件规范应优先依赖语义变量，而不要把某个主题的边角、阴影或字体特征固化进业务组件。可选视觉主题：

| 主题 | 特征 | 适用场景 |
|---|---|---|
| Default | 中性表面、柔和边界、轻量阴影、圆角 | 通用 SaaS、后台、工具型产品；建议作为本项目默认 |
| Brutalism | 直角、粗边框、高对比、表现力强的阴影；定制展示字体 | 强个性活动页或品牌化体验 |
| Glass | 半透明表面、背景模糊、柔和浮层阴影 | 背景有足够纹理/渐变的沉浸式场景 |
| Mouve | 暖紫调，强调色表面有抬升高光，次要胶囊按钮有按压感 | 需要更柔和、触感更明显的品牌主题 |

避免在默认业务页面混用多种主题的特征。Glass 需要可见背景才能看出模糊；在高密度数据界面优先使用 Default。

## 3. 颜色系统

### 3.1 语义角色

| Token | 作用 | 使用规则 |
|---|---|---|
| `background` / `foreground` | 页面底色 / 主文字与图标 | 页面根容器使用 `bg-background text-foreground` |
| `surface` / `surface-foreground` | 卡片、面板等非浮层内容 | 用于主要内容容器 |
| `surface-secondary`、`surface-tertiary` | 更深一层的容器或控件背景 | 表达嵌套层级，避免单靠边框区分 |
| `overlay` / `overlay-foreground` | 菜单、弹层、弹出面板 | 与页面表面分离并使用 overlay 阴影 |
| `accent` / `accent-foreground` | 品牌强调色与其上文字 | 主要操作、选中态、关键强调；避免大面积滥用 |
| `default` / `default-foreground` | 中性控件与次要强调 | 中性按钮、未选中状态等 |
| `muted` | 次要文字、占位信息 | 仍需满足可读性，不用于关键数值 |
| `success`、`warning`、`danger` | 成功、警告、错误/危险状态 | 仅在对应语义出现时使用；可搭配 soft 背景 |
| `field-*` | 表单控件背景、文字、占位、边框 | 输入控件可独立于卡片表面调整 |
| `separator`、`border`、`focus`、`link` | 分隔线、描边、焦点环、链接 | 优先使用系统计算值与主题值 |
| `chart-1` 至 `chart-5` | 图表序列色 | 从 accent 派生；多系列图表保持相邻序列可区分 |

前景色命名规则：不带后缀的颜色代表背景/填充；`-foreground` 表示置于该背景上的文字或图标。使用系统生成的 hover、soft、separator 层级，避免手工重复计算。

### 3.2 默认主题参考值

以下 OKLCH 数值来自 HeroUI v3 当前默认主题，不转换成 HEX，以免损失原始色彩精度。部分颜色由基础 token 自动计算，具体派生关系见源码和颜色文档。

| Token | Light | Dark |
|---|---|---|
| `background` | `oklch(0.9702 0 0)` | `oklch(12% 0.005 285.823)` |
| `foreground` | `oklch(0.2103 0.0059 285.89)` | `oklch(0.9911 0 0)` |
| `surface` | `oklch(100% 0 0)` | `oklch(0.2103 0.0059 285.89)` |
| `surface-secondary` | `oklch(0.9524 0.0013 286.37)` | `oklch(0.257 0.0037 286.14)` |
| `surface-tertiary` | `oklch(0.9373 0.0013 286.37)` | `oklch(0.2721 0.0024 247.91)` |
| `accent` | `oklch(0.6204 0.195 253.83)` | 与 Light 共用该值 |
| `success` | `oklch(0.7329 0.1935 150.81)` | 与 Light 共用该值 |
| `warning` | `oklch(0.7819 0.1585 72.33)` | `oklch(0.8203 0.1388 76.34)` |
| `danger` | `oklch(0.6532 0.2328 25.74)` | `oklch(0.594 0.1967 24.63)` |
| `muted` | `oklch(0.5517 0.0138 285.94)` | `oklch(70.5% 0.015 286.067)` |
| `default` | `oklch(94% 0.001 286.375)` | `oklch(27.4% 0.006 286.033)` |
| `border` | `oklch(90% 0.004 286.32)` | `oklch(28% 0.006 286.033)` |
| `separator` | `oklch(92% 0.004 286.32)` | `oklch(25% 0.006 286.033)` |

基础几何值：`--spacing: 0.25rem`（4px 步长）、`--radius: 0.5rem`（8px）、`--field-radius: calc(var(--radius) * 1.5)`（默认 12px）、`--border-width: 1px`、`--field-border-width: 0px`。表单字段默认无边框，边界由底色、hover、focus 与焦点环共同表达。

### 3.3 Light / Dark 使用方式

切换主题时替换语义变量，不要在每个组件里复制一套颜色判断。确保 `html` 上的 class 或 `data-theme` 与系统约定一致：

```html
<html class="light" data-theme="light">
  <body class="bg-background text-foreground">
    <!-- application -->
  </body>
</html>
```

```html
<html class="dark" data-theme="dark">
```

HeroUI 默认暗色模式会重设背景、表面、覆盖层、分隔线、字段和状态色；暗色表面通常不依赖投影，改用明度层级和细描边区分。浮层通过轮廓与轻微内高光保持可辨识。

## 4. 字体与图标

### 字体

- 默认主题保持清晰的现代无衬线字体；具体字体栈由应用全局字体配置决定。不要在单个页面随意切换字体。
- 通过字号、字重、行高区分层级，避免仅靠颜色区分标题与说明。
- 推荐页面层级（项目建议，可按实际密度微调）：页面标题 28–32px / 600；区块标题 18–20px / 600；正文 14–16px / 400；辅助说明 12–14px / 400；数字 KPI 使用 tabular numerals。
- 正文行高建议 1.45–1.6；紧凑标签和表格行可使用 1.3–1.45。标题保持自然字距，不额外扩字。
- Pro 主题可能带入字体覆盖，例如 Brutalism 的 Anton 与 Share Tech Mono；只有明确采用该主题时才应用。

### 图标

- 统一使用一套线性图标；HeroUI 官方默认基于 Gravity UI Icons。
- 常规图标建议 16px，按钮/导航图标可用 16–20px，强调型空状态插画除外。
- 图标与文字使用同一语义颜色。纯图标按钮必须提供可访问名称，并呈现与文本按钮一致的 hover、focus、disabled 状态。
- 图标只做识别或补充信息，不用图标代替不清楚的文案。

## 5. 布局、间距与层级

- 以 4px 为基础间距步长；推荐常用间距：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px。
- 内容使用清晰的容器边界与对齐线。仪表盘优先采用侧栏 + 顶部栏 + 主工作区；窄屏将侧栏折叠为抽屉/导航入口。
- 信息卡片内边距建议 16–24px；表单字段组间距 16–24px；页面区块间距 24–40px。密集数据表单可收紧，但行列基线须一致。
- 默认圆角轻柔、统一：输入控件约 12px；普通卡片按 8–12px 体系；胶囊形状只用于 chip、segmented control 等有明确用途的控件。
- 内容卡片使用 `surface`，嵌套区块使用次级 surface，浮层使用 `overlay`。阴影只标记悬浮层级；普通分区优先使用表面明度和分隔线。
- 复杂工作区可以使用 Resizable、AppLayout、Sidebar 和 Sheet；避免每块内容都包在独立卡片中造成碎片化。
- 响应式规则以内容可读和操作可达为先：宽表格允许横向滚动或提供列管理；窄屏操作入口不能只依赖 hover。

## 6. 通用组件规范

### 操作组件

| 组件 | 规范 |
|---|---|
| Button | `primary` 用于当前上下文最重要的正向操作；`secondary` 为并列替代；`tertiary` 用于取消/跳过等低强调动作；`ghost` 用于轻量工具操作；`danger` 用于破坏性操作。支持文本、图标、纯图标、加载、禁用。 |
| Link | 用于导航；使用链接语义和一致的 hover/focus，不以按钮样式承载页面跳转。 |
| Icon Button | 适用于工具栏和行内动作；明确 tooltip/aria-label；点击热区要足够大。 |
| Chip / Badge | 显示分类、状态或数量；优先中性样式，语义状态才使用对应 soft 色。不要把装饰性标签做成按钮。 |
| Toggle / Checkbox / Radio | 清楚区分选中与未选中；卡片式选项可用 CheckboxButtonGroup/RadioButtonGroup；点击整项可操作时提供对应语义。 |
| Switch | 用于即时生效的开关设置；若需要提交或保存，优先 checkbox + 保存流程。 |
| Tabs / Segment | Tabs 切换页面级内容；Segment 在同一内容区域内切换互斥视图或筛选。选中态必须清晰。 |

### 表单组件

- 表单项由 Label、Control、Description、Error Message 组成；标签不可仅靠 placeholder 代替。
- 错误信息靠近字段出现，说明如何修正；保留无效值并明确聚焦首个错误。
- 输入提供默认、hover、focus-visible、disabled、invalid、readonly 状态；focus 使用 `focus`/`accent` 焦点环。
- 搜索框显示搜索语义并提供清除动作；密码、数字、日期、文件上传使用合适的专用控件。
- 长流程使用 Stepper 展示当前步骤和已完成步骤；每一步都给出继续/返回行为与验证反馈。
- 上传使用 DropZone 显示支持格式、体积限制、进度、失败与重试；拖放不是唯一入口。

### 容器与数据展示

| 组件 | 规范 |
|---|---|
| Card / Widget | 使用 Header、Title、Description、Body、Footer 等组合插槽；标题描述卡片目的，操作集中在头部或尾部。 |
| Data Grid / Table | 固定清晰列头；数字右对齐、文本左对齐；支持排序/筛选/分页时标出当前状态。包含 loading、empty、error、selection、row action 与窄屏策略。 |
| List View | 适用于纵向对象集合；行内主次信息分层，主要动作不和行选择冲突。 |
| KPI / Number Value / Trend Chip | 数值突出、单位完整、趋势有基准和时间范围；正负趋势同时配方向符号/文字，不只用红绿。 |
| Charts | 使用主题派生的 `chart-1` 至 `chart-5`；标题、单位、时间范围、图例与 tooltip 齐全；图表颜色需在明暗模式均可辨认。 |
| Empty State | 写清当前没有什么、可能原因和下一步；只有明确可执行时才放 CTA。 |
| Timeline / Kanban / Agenda | 卡片内容密度保持一致；状态变化与拖拽目标有明确视觉反馈；提供非拖拽的可访问操作方式。 |
| File Tree | 缩进/连接线表达层级，展开状态清楚，拖动/投放目标可辨认。 |

### 导航与布局

- `AppLayout` 提供应用区域骨架，`Navbar` 承载全局入口和账户动作，`Sidebar` 承载分区导航。
- `Command` 用于全局搜索和快捷动作，显示键盘提示与分组；可用快捷键打开并支持键盘操作。
- Breadcrumbs 表达层级路径；Pagination 管理有界集合；Tabs 表示同级内容切换。
- Context Menu 只放与当前对象相关的操作；危险操作分组并设置确认流程。
- Resizable 用于多面板工作区；拖动把手需可聚焦、可键盘调整或提供替代布局。

### 浮层与反馈

| 组件 | 规范 |
|---|---|
| Modal / Sheet / Drawer | 适用于需要暂时聚焦的流程；宽屏对话框、侧向详情用 Sheet/Drawer；控制焦点、Escape、背景遮罩和滚动锁。 |
| Popover / Hover Card | 展示补充信息或就地控件；保持触发关系明确，避免承载过长或关键流程。 |
| Tooltip | 仅补充简短说明；不放必需信息；延迟出现，键盘聚焦也可触发。 |
| Alert Dialog | 用于需要明确选择的高影响动作；说明后果，危险按钮清晰区分。 |
| Toast | 短时反馈；不要承载必须保存的消息；成功/失败/Promise 等状态要准确，允许必要时撤销。 |
| Progress | 确定进度用百分比/步骤；不确定进度用 indeterminate；附带可读文本，长任务给出状态说明。 |

## 7. HeroUI Core Web 组件目录

基础层涵盖下列组件。它们提供日常交互、表单和页面骨架；Pro 组件在这些能力之上扩展工作区、数据可视化和 AI 场景。

### Buttons、Collections 与 Controls

- Button、ButtonGroup、CloseButton、ToggleButton、ToggleButtonGroup
- Dropdown、ListBox、TagGroup
- Slider、Switch

### Colors 与 Data Display

- ColorArea、ColorField、ColorPicker、ColorSlider、ColorSwatch、ColorSwatchPicker
- Badge、Chip、Table

### Date and Time

- Calendar、DateField、DatePicker、DateRangePicker、RangeCalendar、TimeField

### Feedback

- Alert、Meter、ProgressBar、ProgressCircle、Skeleton、Spinner

### Forms

- Checkbox、CheckboxGroup、Description、ErrorMessage、FieldError、Fieldset、Form、Input、InputGroup、InputOTP、Label、NumberField、RadioGroup、SearchField、TextField、TextArea

### Layout、Media 与 Navigation

- Card、Separator、Surface、Toolbar
- Avatar、AvatarGroup
- Accordion、Breadcrumbs、Disclosure、DisclosureGroup、Link、Pagination、Tabs

### Overlays、Pickers、Typography 与 Utilities

- AlertDialog、Drawer、Modal、Popover、Toast、Tooltip
- Autocomplete、ComboBox、Select
- Kbd、Typography
- ScrollShadow

## 8. HeroUI Pro Web 组件目录

以下按官网 React Web 组件目录归类。Pro 是在 HeroUI 基础组件之上的扩展；基础 Button、Card、Modal、Input 等仍遵循 HeroUI OSS 的基础 API/文档。官网组件与变体会持续增加，实施时以当前文档为准。

### Charts

- Area Chart、Bar Chart、Chart Tooltip、Composed Chart、Line Chart、Pie Chart、Radar Chart、Radial Chart

### Data Display

- Agenda、Action Bar、Carousel、Data Grid、Empty State、File Tree、Floating TOC、Holo Card、Hover Card、Kanban、Item Card、Item Card Group、KPI、KPI Group、List View、Map、Timeline、Widget

### AI

- Chain Of Thought、Chat Attachment、Chat Conversation、Chat List View、Chat Loader、Chat Message、Chat Message Actions、Chat Source、Chat Tool、Code Block、Markdown、Prompt Input、Prompt Suggestion、Text Shimmer

### Feedback

- Emoji Reaction Button、Number Value、Pressable Feedback、Rating、Trend Chip

### Layout

- Resizable

### Forms

- Cell Color Picker、Cell Select、Cell Slider、Cell Switch、Checkbox Button Group、Drop Zone、Inline Select、Native Select、Number Stepper、Radio Button Group、Rich Text Editor

### Navigation

- AppLayout、Command、Context Menu、Navbar、Segment、Sidebar、Stepper

### Overlays

- Emoji Picker、Sheet

## 9. HeroUI Pro 页面模板与布局配方

HeroUI Pro 模板是可运行的完整应用骨架，适合参考信息架构、导航和组件组合。它们不是单一视觉皮肤：各自服务于不同任务密度。保留默认主题的颜色/状态约定，再按页面任务选用相应骨架。

| 模板 | 主要任务 | 页面骨架与内容模块 | 关键组件组合 |
|---|---|---|---|
| Dashboard | 查看经营表现并处理管理数据 | 持久侧栏（Dashboard、Orders、Tracker、Analytics、Settings、Help）；主区以 Overview 和时间范围筛选开头；首屏 KPI 横排；下方趋势图/流量来源；末尾员工等实体数据表，含搜索、筛选、排序、列操作。 | AppLayout + Sidebar + KPI/KPI Group + Charts + Select/Segment + Data Grid + 下载动作 |
| Mail | 快速分拣邮件并阅读/撰写 | 三栏工作区：邮箱/标签导航、带摘要的会话列表、邮件阅读区；导航包含 Inbox、Starred、Sent、Drafts、Snoozed、Archive、Spam、Trash 和用户标签；未选中会话时显示空状态；New email 进入撰写流程。 | Resizable/AppLayout + Sidebar + SearchField + List View + 邮件详情面板 + Empty State + Sheet/Modal compose |
| Chat | 在多轮会话中探索、提问并检查 AI 结果 | 左侧 New Chat、Library、Explore 与 Recent 会话；主区是可滚动对话；回答内部组合思考摘要、计划、Markdown/代码、工具调用与审批、来源、文件附件和媒体；底部固定 Prompt Input。 | Sidebar + Chat List View + Chat Conversation + Chat Message + Chain Of Thought + Chat Tool + Chat Source + Markdown/Code Block + Chat Attachment + Prompt Input |
| CRM | 跟踪销售阶段、风险和预测 | 工作区以 Pipeline 为主入口；顶部日期范围和 pipeline filter；首屏指标显示 pipeline coverage、当日会议、季度流失、赢单率、风险项和逾期跟进；中部用 Created vs Closed、Days to Close、Weighted Forecast 和 Pipeline Funnel 分析阶段；下部展示重点 Accounts 与 Opportunities，支持进入公司档案。 | AppLayout/Sidebar + KPI Group + DateRangePicker + Filters/Segment + Charts + Kanban 或阶段 Funnel + Item Card/Account list + Data Grid |
| Finances | 检查资产表现、持仓和交易记录 | 导航分为 Dashboard、Portfolio、Spending、Transactions、Earn、Settings；顶部总余额、24 小时变化、最佳表现资产、资产数量；Portfolio 图表配时间段切换；持仓列表展示资产、数量/价值和涨跌；Recent Activity 表展示交易类型、资产、金额、日期。 | Sidebar + KPI/KPI Group + Line/Area Chart + Segment + Item Card/List View + Data Grid + Number Value/Trend Chip |

### 模板中提炼的通用页面规则

1. **先给全局框架，再给任务内容。** 后台类页面使用持久侧栏 + 主工作区；顶栏只放全局搜索、范围选择、账户/辅助操作。菜单名称和当前页面要有明确选中态。
2. **按任务顺序排信息。** 先放“当前发生什么”的摘要与范围控件，再放解释趋势的图表，最后放需要逐行处理的数据集合。不要让图表和表格抢同一层级。
3. **KPI 卡片应能快速比较。** 同组指标统一数值字号、标签位置、单位和趋势表达；趋势提供比较周期与基准，正负变化同时显示符号或文字。
4. **列表与详情构成稳定主从关系。** 邮件、会话、账户等对象先在列表中扫描，再在独立详情区阅读/操作。宽屏可并排；空间不足时改为导航到详情页或用 Sheet 承载详情。
5. **筛选上下文放在结果之前。** 日期范围、状态、搜索、排序应贴近它们控制的图表/列表，并显示当前生效条件；提供清除筛选和空结果状态。
6. **数据行呈现核心识别信息。** 主标题、对象/账户、状态、金额/时间按固定列或固定行位对齐；交易 ID 等长值截断并支持查看完整值。
7. **密集工作区要留出阅读和操作空间。** 面板宽度可调整；长列表独立滚动；顶部工具区保持稳定；窄屏将侧栏收为 Drawer，将并列详情改成单列路径。
8. **模板内容是结构示例。** 指标名称、商业规则、筛选默认值、交易状态和 AI 执行权限应由具体产品定义，不从演示数据推断。

### 按场景选用模板骨架

- **管理/运营后台：** 从 Dashboard 开始，采用 KPI → 趋势图 → 数据表的纵向节奏。
- **收件箱/工单/对象管理：** 从 Mail 的三栏主从布局开始，窄屏时转为列表页与详情页两步导航。
- **AI 助手：** 从 Chat 的会话侧栏 + 消息工作区 + 固定输入区开始；工具结果、来源和审批是消息流中的可检查部分。
- **销售管理：** 从 CRM 的 pipeline 总览开始，将阶段、预测、风险账户和机会列表放在同一业务路径中。
- **资产/支付后台：** 从 Finances 开始，摘要先于持仓/交易明细；数额同时明确币种、统计区间和变化基准。

## 10. AI 对话专用模式

- 消息区分用户、助手与工具结果；回答内容可包含 Markdown、引用来源、代码块和思考/工具执行状态。
- `Prompt Input` 支持输入、附件、工具动作、发送中、停止生成、重试和排队状态；发送键、附件和辅助动作明确分组。
- 流式输出期间提供轻量加载反馈；失败时保留用户输入，给出重试入口；用户滚离底部后不强制抢回滚动位置，可显示回到底部按钮。
- 来源、工具调用、推理摘要等内容使用可折叠细节组件，默认层级低于最终回答。
- Markdown 代码块展示语言、复制反馈和横向溢出处理；复制成功要有明确反馈。

## 11. 交互状态与动效

组件状态统一采用以下视觉职责：

| 状态 | 表现 |
|---|---|
| Hover | 轻微背景/描边变化；不引起布局跳动 |
| Pressed | 短暂颜色加深或轻微缩放；避免过度弹性效果 |
| Focus Visible | 高对比、可见焦点环；不因鼠标点击长期显示键盘焦点 |
| Selected / Expanded | 使用 accent/soft 背景、指示器或展开图标等多重线索 |
| Disabled | 降低强调、阻止交互，仍保持文字可辨认；默认禁用透明度参考 50% |
| Loading | 保持控件尺寸与位置稳定，说明正在执行的动作并防止重复提交 |
| Invalid | danger 色 + 文本错误解释；避免只用红色边框传意 |

动效以快速、平稳、可预测为目标：操作反馈建议 120–200ms，浮层进出建议 160–240ms；组件动画应尊重减少动态效果设置。HeroUI 自带动效优先于每页重复造动效。

## 12. 无障碍与内容规则

- 所有控件可以用键盘访问；焦点顺序与视觉顺序一致；弹层正确捕获和还原焦点。
- 使用原生语义和 ARIA 状态；复合控件的选中、展开、禁用、错误等状态同步到辅助技术。
- 文本与背景满足 WCAG AA 对比度；焦点指示、图标、图表不单独依赖颜色。
- 表单错误使用字段关联描述；加载和异步完成使用适当的 live region。
- 表格提供表头语义，图表提供摘要或数据表替代；图标按钮带可访问名称。
- 中文界面优先简洁动作文案；日期、数字、货币按照用户区域设置格式化。

## 13. Web 实现约定

使用 Tailwind CSS v4 与语义 token；默认完整样式导入顺序如下：

```css
@import "tailwindcss";
@import "@heroui/styles";
@import "@heroui-pro/react/css";
```

若选用 HeroUI Pro 主题，将主题 CSS 放在 Pro 样式之后。例如：

```css
@import "tailwindcss";
@import "@heroui/styles";
@import "@heroui-pro/react/css";
@import "@heroui-pro/react/themes/mouve";
```

在 HTML 根节点用 `data-theme="light"` 或 `data-theme="dark"` 控制默认主题；Pro 主题使用 `brutalism-light/dark`、`glass-light/dark` 或 `mouve-light/dark`。样式导入顺序错误可能使 Pro 样式被覆盖。

- 在 JSX/CSS 中使用语义类，如 `bg-background`、`bg-surface`、`text-foreground`、`text-muted`、`bg-accent`。
- 自定义颜色必须定义 light 和 dark 两套值，并映射到 Tailwind `@theme inline`；不要只补 light 值。
- 样式微调优先使用组件 BEM 类与主题变量；避免以任意 `!important` 或硬编码 hex 覆盖基础系统。
- 表单使用 `field-*` 变量，普通容器使用 `surface-*`，浮层使用 `overlay` 与 `overlay-shadow`。
- Pro 组件的 CSS 和可选依赖可能通过子路径导入；只有使用对应组件时再加入相关 peer dependency。

## 14. 页面设计检查清单

- [ ] 页面背景、容器和浮层使用正确的语义 token。
- [ ] 同一操作区域只有一个最重要的 primary action。
- [ ] Light 与 Dark 下文字、边界、图表和状态都清晰。
- [ ] 表单包含标签、帮助说明、错误与禁用状态。
- [ ] 数据列表提供加载、空、错误、分页/筛选和响应式策略。
- [ ] 所有纯图标操作有 accessible name；键盘焦点清楚。
- [ ] 动效遵循减少动态偏好；hover 不是唯一的操作提示。
- [ ] 组件使用 HeroUI 原生能力与复合结构，没有重复造等价组件。

## 15. 官方参考

- [HeroUI Pro React Components](https://heroui.pro/docs/react/components) — 当前 Web Pro 组件目录与组件分组。
- [HeroUI Pro Templates](https://heroui.pro/docs/react/templates) — Dashboard、Mail、Chat、CRM、Finances 五类 Web 模板。
- [Dashboard Template Preview](https://template-dashboard.heroui.pro/) — 指标、趋势图、筛选和管理数据表。
- [Mail Template Preview](https://template-email.heroui.pro/) — 邮箱文件夹、会话列表和消息详情。
- [Chat Template Preview](https://template-chat.heroui.pro/) — AI 会话、工具、来源和消息输入区。
- [CRM Template Preview](https://template-crm.heroui.pro/) — 销售 pipeline、预测、风险账户和机会。
- [Finances Template Preview](https://template-4.heroui.pro/) — 资产摘要、持仓、走势和交易活动。
- [HeroUI React Components](https://heroui.com/en/docs/react/components) — 当前 HeroUI Core Web 组件目录与组件分组。
- [HeroUI Pro Theming](https://heroui.pro/docs/react/getting-started/theming) — Pro 样式导入顺序、明暗模式与主题说明。
- [HeroUI Pro Colors](https://heroui.pro/docs/react/getting-started/colors) — Pro 图表色板与主题派生规则。
- [HeroUI Design Taste](https://heroui.pro/docs/react/getting-started/design-taste) — 间距、字体、语义色、表单、按钮、导航与无障碍原则。
- [HeroUI Colors](https://heroui.com/en/docs/react/getting-started/colors) — 颜色角色及用法。
- [HeroUI Theming](https://heroui.com/en/docs/react/getting-started/theming) — CSS 变量、BEM、Tailwind v4 集成与主题切换。
- [Default Theme Variables](https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/default/variables.css) — 上述默认 light/dark OKLCH 值、圆角、间距和阴影。
