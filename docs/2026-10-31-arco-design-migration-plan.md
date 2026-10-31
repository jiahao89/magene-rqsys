# Arco Design 前端架构迁移开发计划

> **日期**：2026-10-31
> **状态**：P0 完成（云端已验证）；P1/P2 第一轮完成（canonical 组件与外壳 Arco 化）；P4 进行中（client 基础 + 按钮已上线）
> **分支策略**：工作分支 `feature/arco-design`；每个增量提交同时推送该分支与 `main`
> **部署策略**：妙搭部署继续使用 `main` 版本（妙搭仓 `sprint/default` 从 main 同步），`feature/arco-design` 不直接发布

## 1. 背景与目标

当前两套前端：

| 位置 | 技术栈 | 角色 |
|---|---|---|
| `apps/web` | React 19.3 + HeroUI 3.2.6 + Tailwind 4 + Vite 7 | 根仓 canonical 工作台 |
| `rq-sys-miaoda/client` | React 19.2 + Tailwind 4 + Radix 原语 | 妙搭运行时客户端（线上界面） |

目标：把前端 UI 架构统一迁移到 **Arco Design**（`@arco-design/web-react` 2.66.x），保留现有 API、DTO、业务状态机与路由不变；视觉与交互以 Arco 组件为基准，逐步移除 HeroUI（根仓）与被替换的 Radix 原语（妙搭 client）。

**核心不确定项**：妙搭云端构建能否安装并构建 Arco 依赖（网络/依赖体积/Node 环境）。本计划把该验证放在 P0，未通过前不把 Arco 代码合入 main。

## 2. 约束与现状事实

- React 版本：根仓 web 19.3.0、妙搭 client 19.2.x；Arco 2.66.18 `peerDependencies` 为 `react>=16`、`react-dom>=16`，安装不会被 peer 拦截；运行时（React 19 移除 `findDOMNode` 等）仍需 P0 实测。
- Arco 包体积：unpacked ≈17.2 MB；按需引入后桌面工作台 chunk 预计增加 150–300 KB gzip（P0 量化）。
- 妙搭构建：`scripts/build.sh` → `vite build`（client）+ Nest build；依赖由云端按 `package.json` 安装，**新增依赖能否安装必须实测**。
- ADR-001 规定 `apps/web` 使用 HeroUI v3；迁移 Arco 前需新增/更新 ADR 明确替代关系；妙搭 client 仍禁止 HeroUI，Arco 不受此限。
- 业务约束不变：`(TB project ID, TB requirement ID)` 身份、处理闸门（重复/忽略压制）、PM 状态只读、Base 幂等键等均不因 UI 迁移改变。
- 现有资产：根仓 Web 95 个测试、`apps/web` 全量 typecheck/build；妙搭 client 无前端单测（依赖 typecheck + build + 目标环境验证）。

## 3. 目标架构

1. **组件层**：Arco 作为唯一主 UI 库；`@arco-design/web-react` 按需引入，必要时使用 `@arco-design/web-react/icon`。
2. **样式层**：Tailwind 保留布局/工具类；移除 HeroUI 主题层；Arco 样式通过 `ConfigProvider` + 全局 token 桥接，尽量复用现有 `--rq-*` CSS 变量（颜色/字号/间距）避免视觉断裂。
3. **主题**：沿用现有 `rq-sys-theme`（light/dark）+ `<html data-theme>`；Arco 使用 `ConfigProvider` 的暗色算法/自定义 token 同步；保留顶栏主题切换。
4. **状态与数据**：API 客户端、DTO、轮询/静默刷新、骨架屏逻辑不变；组件替换不改变请求时序与幂等语义。
5. **双仓**：canonical 实现先在 `apps/web` 完成并通过测试，再镜像到妙搭 client（行为对齐、组件库一致，但不引入 HeroUI）。

## 4. 阶段计划

### 4.0 P0 实测结论（2026-10-31，临时工程，未改仓库）

| 验证项 | 结果 |
|---|---|
| 安装 | `@arco-design/web-react@2.66.18` + React 19.3.1 安装成功，peer 声明 `react>=16`，无 peer 拦截 |
| Vite 客户端构建 | 成功（808 modules）；宽组件面：JS 850 KB / gzip 248 KB，CSS 570 KB / gzip 64 KB（全量 arco.css） |
| 按需导入（9 组件，无全量 CSS） | JS 715 KB / gzip 211 KB（Arco 共享运行时占主导，需路由级 code split） |
| SSR（React 19） | 成功渲染 13.6 KB HTML；仅测试代码自身的 Breadcrumb key 警告，无 React 19 致命错误 |
| 客户端挂载（jsdom，React 19） | 成功挂载，Arco class/Table 正常渲染，无报错 |
| **React 19 适配器** | **必需**：Arco 内部 `Message/Notification/Modal.confirm` 等命令式 API 走 `_util/react-dom.render`，React 19 已移除 `ReactDOM.render`；不引入 `@arco-design/web-react/es/_util/react-19-adapter` 会抛 `TypeError: ...render is not a function`，引入后正常 |
| 妙搭云端构建 | **已验证**：独立临时应用 `app_17h45brz8hb`（frontend）安装 Arco 2.66.18 后构建成功，release `7702724680834567437` finished（commit `7ec0d11`）；线上页面 Arco 样式/组件正常，Message/Modal/dark 切换均可用，未触碰生产应用 |

**P0 结论**：技术路线可行，云端构建可安装并构建 Arco；P1 起必须在入口统一引入 React 19 适配器，并把 bundle 分析（路由级拆分/按需 CSS）纳入每阶段验收。ADR-002 已记录该决定。


### P0 可行性验证（0.5–1 人日）

- 在独立临时工程（不改仓库）验证：React 19 + Arco 2.66.18 + Vite 构建、SSR/组件渲染无致命错误；
- 量化 Arco 引入后的 JS/CSS 体积；
- 验证妙搭云端构建路径的可行方案（见风险 R1）并输出结论；
- 产出 ADR 草案与迁移组件清单（HeroUI/Radix → Arco 映射表）。

**Gate**：React 19 下构建与核心组件渲染通过；体积在可接受范围；云端构建路径有明确结论。

### P1 基础设施与外壳（2–3 人日）

- 安装 Arco、配置按需引入与样式入口；`ConfigProvider`（zhCN、主题、暗色）；
- 设计 token 桥接（颜色/字号/圆角/阴影对齐现有 `--rq-*`）；
- 外壳迁移：Layout、侧栏菜单、顶栏（面包屑/连接状态/主题切换/帮助入口）、响应式断点、骨架屏容器；
- 更新 ADR-001（HeroUI → Arco）。

**Gate**：外壳视觉与交互验收；typecheck、build、现有 Web 测试通过（先保留旧组件测试直到对应面板迁移）。

### P2 核心面板迁移（5–8 人日）

按用户主路径顺序：
1. 总览（统计卡、待办、批次进度、最近同步）；
2. 需求池（筛选栏、表格、分页、处理视图、批量/行操作、空态/骨架屏）；
3. 需求详情（摘要卡、AI 评分、U/M/S/C、RICE/Kano Beta、人群、重复处理、审计/同步记录侧栏）；
4. 新建/编辑表单（校验、保存、错误提示）。

**Gate**：核心路径手工回归 + 目标环境等价行为；相关测试迁移/重写；无整页刷新回归。

### P3 其余面板（4–6 人日）

同步记录（批次/审计）、团队管理、功能模块、数据源与计划、优先级规则、使用指南；统一空态/错误态/权限提示。

**Gate**：全部页面 typecheck/build、测试通过；视觉走查清单完成。

### P4 妙搭 client 镜像与云端构建验证（3–5 人日）

- 按双仓对齐规则镜像 Arco 改造到 `rq-sys-miaoda/client`（Tailwind + Arco，不引入 HeroUI）；
- 云端构建验证：先在**非生产验证路径**（见风险 R1 方案）确认 Arco 安装/构建成功，再发布；
- 目标环境功能回归（登录、需求池、详情、重复处理、评分、Beta、主题切换、深链）。

**Gate**：妙搭云端构建成功 + 目标环境核心路径验证通过。

### P5 清理、测试与上线（2–4 人日）

- 移除 HeroUI 依赖/主题、清理未使用 Radix 组件与旧 CSS；
- 恢复并扩充自动化测试；bundle 分析与性能基线（首屏、交互）；
- 可访问性检查（键盘、焦点、对比度、reduced-motion）；
- 更新 README/ADR/PRD 相关说明；执行发布与回滚演练。

**合计**：约 **17–27 人日**（不含外部评审/等待）。

### 4.5 已交付范围（2026-10-31 第一轮）

| 范围 | 状态 | 证据 |
|---|---|---|
| 根仓 `apps/web` 组件层 | ✅ HeroUI 移除，Button/Card/Chip/Input/Modal/Collapse 由 Arco 渲染 | commit `0199ad8`；Web 95/95、build 通过 |
| 根仓外壳与设计 token | ✅ 顶栏/操作按钮/搜索框 Arco 化；布局类映射 Arco token | commit `c9dd30c`、`ef6aa0f` |
| 妙搭 client 基础 | ✅ Arco 依赖/CSS/React19 适配器/主题同步/token 桥接 | commit `bbeaef3`；生产 release `7702736124905508102` |
| 妙搭 client 操作按钮 | ✅ 65 个原生按钮改为 Arco Button（保留自定义布局类） | commit `dfe731c`；生产 release `7702737675280059640`，线上已验证主页/需求池/团队页正常 |
| 妙搭 client 表格/下拉 | ✅ 全部列表页（需求池、同步记录、团队、映射、功能模块、审计、分析版本、评分历史、帮助页）已改为 Arco Table/Select；生产多页验证通过 | `2eaff79`、`a23c673`，release `7702748378892274964`、`7702750651457850659` |
| 妙搭 client 唯一保留原生表格 | 九项评分输入网格（分组可编辑表格，保留原生 input 语义，已套 Arco token） | 有意保留 |
| 根仓面板表格/下拉 | ⏳ 原生 `<table>`/`<select>` 仍为自定义实现（已套 Arco token）；需同步调整 Web 测试交互 | — |
| 输入框/表单控件 | ⏳ 两侧仍以原生 input 为主（已套 Arco token） | — |

**剩余事项（下一轮）**：面板级 Arco Table/Select 替换（需同步调整测试与交互）、详情页表单控件、复杂 Beta 面板；完成后再做一次目标环境全量回归与最终发布。

## 5. 分支与发布策略

1. 所有改动提交到 `feature/arco-design`，并按约定同步推送 `main`：
   `git push origin HEAD:refs/heads/feature/arco-design HEAD:refs/heads/main`
2. **合入 main 的前置条件**：本地全量门禁通过（typecheck/build/测试/对齐/diff-check），且云构建风险已按 P0 结论处置。
3. 妙搭发布始终从 `main` 对应的 `sprint/default` 构建；`feature/arco-design` 只用于开发与验证，不直接发布生产。
4. 回滚：main 保持可发布；若云端构建失败，回退 main 到上一个绿色提交并重新发布，分支保留继续修复。

## 6. 风险与缓解

| 编号 | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 妙搭云端构建无法安装/构建 Arco（网络、镜像源、依赖体积） | 高 | P0 实测；无法直连时评估私有源/锁文件/依赖裁剪；必要时在妙搭侧仅保留 Arco 核心组件并配置按需引入；验证失败则暂停上线，main 不合并 |
| R2 | React 19 运行时兼容（`findDOMNode`、legacy context、StrictMode 双调用） | 高 | P0 已验证基础渲染/挂载；**入口必须引入 `react-19-adapter`**，否则 Message/Modal 等命令式 API 崩溃；逐组件替换并回归 |
| R3 | 双 UI 库并存期样式冲突（Tailwind preflight、HeroUI 全局样式） | 中 | 分阶段移除；引入顺序与作用域隔离；P1 先解决 reset/主题冲突 |
| R4 | bundle 体积增加影响首屏 | 中 | 按需引入、路由级 code split、Arco CSS 按需；P0 建立体积基线，超阈值即阻断 |
| R5 | 95 个 Web 测试大量依赖 HeroUI 语义 | 中 | 迁移对应面板时同步重写测试；P1 前建立组件级测试替身（testing-library 查询优先 role/text） |
| R6 | 双仓行为漂移 | 中 | 每个面板完成后立即镜像妙搭 client + 对齐检查；DTO/请求逻辑不重复实现 |
| R7 | 暗色主题与设计 token 不一致 | 低 | P1 建立 token 桥接与主题回归截图清单；暗色逐页走查 |
| R8 | 排期被 Beta/线上问题打断 | 中 | 阶段可独立交付；P0/P1 完成即可评估是否继续 |

## 7. 验证与完成定义（DoD）

- P0：可行性报告（React 19 兼容、体积、云构建结论）+ ADR 草案；
- 每阶段：`npm run typecheck`、`npm run build`、相关测试、`check:alignment`（共享模块变更时）、`git diff --check`；
- P4/P5：妙搭云端构建成功 + 目标环境核心路径手工回归（含重复处理/评分/主题/深链）+ 发布记录；
- 最终：HeroUI/被替换 Radix 依赖移除；bundle 基线达标；回滚方案演练通过。

## 8. 待确认问题

1. 迁移范围：根仓 `apps/web` + 妙搭 client 双端统一迁移（本计划默认），还是仅妙搭 client？
2. 视觉目标：完全采用 Arco 默认设计语言，还是保留现有品牌色/排版并仅替换组件？（默认：保留品牌 token，组件行为遵循 Arco）
3. Tailwind 去留：保留工具类（默认），还是最终完全移除？
4. 云端构建验证路径：是否允许临时创建一个妙搭测试应用/或临时从 `feature/arco-design` 发布到非生产验证路径？
