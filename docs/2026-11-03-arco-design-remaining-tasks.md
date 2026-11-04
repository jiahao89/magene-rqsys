# Arco Design 迁移剩余任务清单

> **快照日期**：2026-11-03
> **代码基线**：root `1ba0bcc` / `rq-sys-miaoda` `3aba63a`
> **审计结论**：组件库已统一为 Arco；**组件覆盖与设计规范均未"完全替换"**。
> **关联文档**：`specs/rq-sys-mvp/ADR-002-arco-design.md`、`design.md` 第 10 节、`docs/2026-10-31-arco-design-migration-plan.md`

## 0. 目标与验收口径

先选定目标，再执行任务：

- **决策（2026-11-03）**：**目标 A 已选定**；目标 B 暂缓并登记为后续决策项。详见 §6「决策记录（2026-11-03）」。
- **目标 A（组件一致，建议先做）**：两端同一功能使用同一 Arco 组件；不再出现"web 是 Arco Input、妙搭是原生 input"这类分叉。视觉仍沿用 RQ 自定义设计语言。
- **目标 B（完整 Arco 设计语言）**：在 A 之上引入 `ConfigProvider` 与 Arco token 主题，收敛硬编码颜色。会改变现有视觉，需设计确认；本轮不做。
- **明确豁免**（同时记录于 `design.md` 10.4 与 `ADR-002`）：日期筛选 2 处 `datetime-local` 保留原生控件（时区安全，ARCO-04）；评分九项输入网格的原生 `<table>`；`skeleton.tsx` 的 `aria-hidden` 占位 `<table>`；`<a>` 导航链接（Arco 无对应 Link 组件）。
- **防回归验收**：`npm run check:arco-styles`（ARCO-12 脚本落地后可用）——源码用到的 Arco 组件必须登记在两端 `arco-styles.ts` 的按需样式列表中，缺失即失败。

## 1. 现状快照（2026-11-03 实测）

| 指标 | `apps/web` | `rq-sys-miaoda/client` |
|---|---|---|
| 第三方 UI 库 | 仅 Arco | 仅 Arco |
| HeroUI / Radix 引用 | 0 | 0（`@heroui` 仅剩 3 行解释性注释） |
| Arco 按钮（JSX 处） | 81（`ArcoButton` 46 + `HeroButton` 35） | 74 |
| Arco Table / Select | 16 / 10 | 16 / 10 |
| Arco Input | 14（`ArcoInput` 2 + `HeroInput` 12） | **0** |
| 原生 `button` | 21 | 24 |
| 原生 `input` | 23 | 34 |
| 原生 `select` | 6 | 6 |
| 原生 `textarea` | 7 | 7 |
| 原生 `details`/`summary` | 2 / 2 | 3 / 3 |
| 自定义 `--rq-*` 变量 | 139 个 | 同源镜像 |
| 硬编码十六进制颜色 | 466 处（328 个不同值，382 处在组件规则） | 467 处 |
| Arco token 引用 | 59 处 | — |
| `ConfigProvider` | 未使用 | 未使用 |
| Tailwind 工具类 | 0（仅 preflight + `@theme`） | 0 |

**最直接的缺口**：数据源、人员、模块、审计筛选等同一批字段，web 用 `HeroInput`（Arco Input），妙搭用原生 `<input>`（`apps/web/src/panels.tsx:215/222/223/291/354` vs `rq-sys-miaoda/client/src/rqsys/panels.tsx:189/196/197/265/319`）。线上跑的是妙搭。

## 2. 任务清单

### P0 · 组件覆盖收尾（目标 A 的必做项）

- [x] **ARCO-01 新建 / 编辑需求表单 Arco 化**
  - 范围：`apps/web/src/intake-form.tsx`（约 62–100、169–185、306–310 行）及妙搭镜像。
  - 替换：原生 `input` → `Input` / `InputNumber`；`textarea` → `Input.TextArea`；保留 `aria-label`。
  - 注意：`ArcoInput` 的 `onChange` 回传字符串而非事件；如继续走 `arco.tsx` 的 `HeroInput` 包装则无需改调用签名。
  - 验收：该文件原生 `input`/`textarea` 归零；两端字段集合一致；表单提交、禁用态、错误展示测试通过。
  - 预估：0.5–1 人日（两仓）。

- [x] **ARCO-02 原生 `select` 全部替换为 Arco `Select`**
  - 范围：`intake-form.tsx` 的 6 处（新建/编辑的来源渠道、需求类型、功能模块；Kano 资料版本）。
  - 注意：Arco `Select` 选项在 portal 中渲染，测试需到 `document` 查询（`design.md` 10.2 已注明）；空选项、禁用态、受控值要覆盖。
  - 验收：两端原生 `<select>` 归零；测试改为 `document` 查询后全绿。
  - 预估：0.3 人日。

- [x] **ARCO-03 数据源 / 人员 / 模块 / 筛选 / 评分编辑控件 Arco 化**
  - 范围：`apps/web/src/panels.tsx`（216/220/224/297/463/968/978–1003/1011/1048/1210–1219/1336/1527/1686/1896 附近）及妙搭镜像；`App.tsx` 规则草稿（522–536）。
  - 重点：把妙搭已落后的字段（项目名称、执行时间、时区、人员搜索、审计筛选）对齐为 Arco `Input`。
  - 验收：两端同名字段组件一致；筛选、评分保存、重复判定流程的现有测试通过。
  - 预估：0.5–1 人日。

- [x] **ARCO-04 Checkbox / 数字输入 / 日期控件统一**
  - 范围：3 处原生 checkbox（同步启用、周计划、涉及安全）→ Arco `Checkbox`；数字阈值与评分 → `InputNumber`。
  - 日期：2 处 `datetime-local`（筛选条）。**待决策**：换 `DatePicker`（引入 dayjs 值转换）或作为已记录例外保留原生控件。建议内部工具先保留并写入豁免清单，避免时区回归。
  - 验收：控件行为（勾选、清空、步进、禁用）有测试；无时区偏移。
  - 预估：0.3 人日。

- [x] **ARCO-05 `details` / `summary` 折叠区替换**
  - 范围：规则「高级设置」（`App.tsx:523`）、筛选「更多筛选」（`panels.tsx:978`）、妙搭审计折叠（`panels.tsx` 对应处）。
  - 方案：改用 Arco `Collapse`（已在用），或复用 `AdvancedActions` 交互契约；保留键盘可达与展开状态语义。
  - 验收：键盘可展开/收起；无 `details` 残留（豁免项除外）。
  - 预估：0.3 人日。

- [x] **ARCO-06 自定义 tablist → Arco `Tabs`**
  - 范围：`panels.tsx:1896` 附近 `role="tab"` 实现。
  - 验收：`aria-selected`/方向键切换/面板关联由 Arco 承担；现有组件契约测试更新。
  - 预估：0.3 人日。

- [x] **ARCO-07 两端同字段一致性验收（回归门槛）**
  - 方法：按字段清单逐项比对 web 与妙搭渲染组件；把结论记录进本文件或 `design.md`。
  - 验收：不存在"同名同义字段、不同组件实现"。
  - 预估：0.3 人日。

### P1 · 设计规范与工程债（目标 B 的前置 / A 的收尾）

- [x] **ARCO-08 决策：引入 `ConfigProvider` 与主题 token**
  - 若选目标 B：入口加 `ConfigProvider`（locale、主题、品牌 token），把 `styles.css` 的 `body[arco-theme]` 桥接收敛为 Arco token；暗色由 Arco 算法 + `html[data-theme]` 同步。
  - 若选目标 A：在本文件记录"自定义设计语言 + Arco 组件"定位，并在 ADR-002 写明与"Arco 默认设计语言"的偏差。
  - 预估：1–2 人日（B）。

- [ ] **ARCO-09 硬编码颜色收敛**（本轮只落规则，存量 hex 收敛列为后续债务；见 §7）
  - 现状：382 处组件级十六进制颜色在 token 定义之外。
  - 目标：先收敛重复值（328 个不同值），把语义色（危险/成功/警告/链接/焦点）映射到 `--rq-*` → Arco token；不要求一次清零。
  - 验收：新增/修改的样式不得直接写 hex；暗色模式无残留浅色。
  - 预估：1–2 人日（B）。

- [x] **ARCO-10 Hero* 命名与死 class 清理**
  - 范围：`arco.tsx` 导出的 `Button/Card/Chip/Input` 在调用处别名 `HeroButton/HeroInput/HeroChip/HeroCard`（47 处）；33 处仍传 `button button-primary|secondary` 字符串（`arco.tsx` 已丢弃、CSS 已删，纯死参数）。
  - 验收：调用处直接使用 Arco 组件或语义化包装名；无死 class；grep `Hero(Button|Input|Chip|Card)` 为 0。
  - 预估：0.2 人日。

- [x] **ARCO-11 文档修正**
  - `design.md:8` 范围仍写 "HeroUI v3 + HeroUI Pro" → 改为 Arco 基线。
  - `design.md:437` "`button button-*` 类只负责布局骨架" 已失真（类被丢弃、CSS 已删）。
  - `design.md:449` 要求表单控件用 Arco，但实现是原生 → 随 ARCO-01～04 落地后保持一致。
  - `ADR-002` 状态"已实施完成"与 `docs/2026-10-31-arco-design-migration-plan.md` 状态"已完成"需按实际情况改写（组件覆盖未完成）。
  - 预估：0.3 人日。

- [x] **ARCO-12 防回归检查**
  - 增加脚本/CI：扫描源码中用到的 Arco 组件，与 `arco-styles.ts` 的 `style/css.js` 列表对照，缺失即失败。
  - 移除 `apps/web/src/arco-styles.ts` 中未使用的 `Breadcrumb` 样式（web 未使用该组件；妙搭使用了）。
  - 预估：0.3 人日。

- [x] **ARCO-13 测试更新与补齐**
  - `Select` portal 相关断言改为 `document` 查询；新增表单控件（Checkbox/InputNumber/DatePicker）用例；保持 95 个 Web 测试全绿。
  - 妙搭前端仍无自动化测试：至少为发布门禁与表单关键路径补最小用例（可放 P2）。
  - 预估：0.5–1 人日。

- [x] **ARCO-14 Tailwind 定位决策**
  - 现状：`@import "tailwindcss"` + `@theme inline`，TSX 中 0 个工具类，实际只承担 preflight/reset 与主题变量。
  - 决策：要么真正用工具类做布局（并更新 `design.md`），要么在文档中改为"Tailwind 仅作 reset/主题桥"并评估是否保留依赖。
  - 预估：0.2 人日（决策 + 文档）。

### P2 · 可选增强（不阻塞 A/B）

- [ ] **ARCO-15 表单引入 `Form` / `Form.Item`**
  - 统一标签、帮助文案、错误关联与校验时机；替换现有 `field-error` 手写逻辑。
  - 工作量较大（涉及所有表单面板），建议在 P0 完成后单独评估。
  - 预估：2–3 人日。

- [ ] **ARCO-16 妙搭客户端自动化测试基线**
  - 目前只有 typecheck/build/目标环境人工验证；建议引入 vitest + testing-library，先覆盖发布门禁、表单提交、删除确认。
  - 预估：2–3 人日。

## 3. 每项任务的完成定义（DoD）

1. `npm run typecheck`、Web 测试、`npm run build` 全绿（根仓改动）。
2. 妙搭仓 `npm run type:check:client`、`npm run build:client` 全绿（镜像改动）。
3. `npm run check:alignment` 通过（仅覆盖 API 共享模块；客户端一致性需按 ARCO-07 人工验收）。
4. 浏览器人工检查：亮/暗主题、≤560px 与 ≤860px 断点、下拉 portal、弹窗焦点、表格横向滚动。
5. 文档同步：`design.md` 第 10 节、ADR-002 状态、本清单勾选。
6. `npm run check:arco-styles` 通过（ARCO-12 脚本落地后生效；缺失按需样式即失败）。

## 4. 验证命令速查

```bash
# 根仓
npm run typecheck
npm --workspace @rq-sys/web run test
npm --workspace @rq-sys/web run build
npm run check:alignment
npm run check:arco-styles   # ARCO-12 脚本落地后可用

# 妙搭仓
cd rq-sys-miaoda
npm run type:check:client
npm run build:client
```

## 5. 风险与注意事项

- **Arco `Select` 在 portal 渲染**：现有测试若用容器内查询会失败，需改为 `document` 查询（`design.md` 10.2 已注明）。
- **Arco `Input` 的 `onChange` 签名**：回传值而非事件；直接使用 `ArcoInput` 时不要沿用 `event.target.value`。
- **表单样式回归**：现有 `.field input/select/textarea` 规则不会作用于 `.arco-input`；需补宽度、错误态、禁用态样式，必要时对比计算样式。
- **日期控件**：`DatePicker` 使用 dayjs，涉及时区；筛选场景建议保留原生 `datetime-local` 并登记豁免，避免偏移。
- **按需样式**：新增 `Input`/`Input.TextArea`/`Checkbox`/`InputNumber`/`Tabs` 等组件时，必须把 `style/css.js` 加进两端 `arco-styles.ts`，否则运行时无样式。
- **双仓镜像**：客户端不在 `check:alignment` 覆盖范围，P0 任务必须两端同时完成，避免再次分叉（本次审计即发现 Input 分叉）。
- **视觉变化**：Arco 控件默认高度/圆角/字号与自定义 CSS 不同（如 small 按钮 28px vs 旧 32px）；涉及处需截图确认。

## 6. 待决策项

1. 目标选 A（组件一致）还是 B（完整 Arco 设计语言）。
2. 日期筛选：Arco `DatePicker` 还是保留原生 `datetime-local`（建议后者，登记豁免）。
3. Tailwind：继续保留并启用工具类，还是降级为 reset/主题桥并更新文档。
4. 是否在 P0 同步清理 `Hero*` 命名与死 class（会扩大 diff，但可由机械替换完成）。

### 决策记录（2026-11-03）

以上 1–4 均已关闭，记录如下：

1. **目标**：选 **目标 A**（组件一致性 + 保留 RQ 自定义设计语言）。理由：清单推荐先做 A，组件分叉是当前主要缺口；目标 B（完整 Arco token/`ConfigProvider` 主题、视觉改写）需单独设计确认，暂缓并登记为后续决策项。在 A 范围内，入口接入 Arco `ConfigProvider` 的 `zhCN` locale（仅中文本地化，不覆盖品牌视觉 token）。
2. **日期筛选**：2 处 `datetime-local` 保留原生控件（时区安全），作为已记录豁免写入 `design.md` 与 `ADR-002`。
3. **Tailwind（ARCO-14）**：保留依赖，定位为「仅 preflight/reset + `@theme inline` 主题桥」（TSX 0 工具类），不启用工具类布局；已同步到 `design.md` 与 `ADR-002`。
4. **Hero\*/死 class（ARCO-10）**：按清单机械清理，状态以 Lead 最终提交为准；本清单不提前勾选代码项。
5. **ARCO-09 颜色**：本轮只落规则——新增/修改样式禁止直接写十六进制颜色，语义色统一走 `--rq-*`；存量 hex 收敛列为后续债务，不在本轮全量清零。
6. **ARCO-12 防回归**：由 Lead 增加按需 Arco 样式检查脚本；运行 `npm run check:arco-styles`（提交后可用）。

## 7. 执行记录与验收证据（2026-11-03）

基线：root `c193458` + 本轮前端改动 / 妙搭 `efdfd19` + 本轮前端改动。目标 A（组件一致 + 保留 RQ 视觉），`ConfigProvider` 仅接入 `zhCN` locale。

| 任务 | 状态 | 证据 |
|---|---|---|
| ARCO-01 | ✅ | `intake-form.tsx` 两仓：原生 input×10 → `Input`、textarea×5 → `Input.TextArea`、select×6 → `Select`；两仓该文件原生 input/textarea/select 归零 |
| ARCO-02 | ✅ | 6 处 select 全部 `Select`；panels.test 用 `chooseArcoOption`（portal 查询）覆盖新建/编辑渠道选择 |
| ARCO-03 | ✅ | web panels 6×`ArcoInput`（行内模块名、需求搜索、批次 ID、评分理由、重复理由、人工优先级理由）+ 1×`TextArea`；妙搭 panels 14×`ArcoInput`（项目名/执行时间/时区/人员搜索/审计对象等）；两端同名字段 label 集合一致（§7.1） |
| ARCO-04 | ✅ | Checkbox×3（同步/周计划/安全）→ `ArcoCheckbox`；InputNumber×13（9 评分 + alpha + 3 阈值）→ `ArcoInputNumber`；2 处 `datetime-local` 保留原生并注释豁免 |
| ARCO-05 | ✅ | 3 处 details/summary（规则高级设置、更多筛选、妙搭审计折叠）→ 受控 `ArcoButton`（aria-expanded/aria-controls）+ 条件渲染；`<details>`/`<summary>` 在两端 TSX 归零；死 CSS 规则清理 |
| ARCO-06 | ✅ | 2 处自定义 tablist → 受控 `ArcoTabs`（人员/负责人映射、同步批次/审计）；删除 `CompositeTabs`；外层 `role="group"` + aria-label（Arco Tabs 自身不渲染 `role=tablist`，库限制已记录） |
| ARCO-07 | ✅ | 见 §7.1 两端一致性审计；42 个同义字段全部为 Arco 同源组件（web 包装层 `Input/Button` ↔ 妙搭 `ArcoInput/ArcoButton` 均为 Arco 渲染）；差异项与功能缺口见 §7.2 |
| ARCO-08 | ✅（A） | 选定目标 A；两仓入口接 `ConfigProvider locale={zhCN}`（web `main.tsx`、妙搭 `client/src/index.tsx`）；未覆盖品牌 token；目标 B 暂缓 |
| ARCO-09 | ⏳ | 规则已落：新增/修改样式只用 `--rq-*`/`rgb(var(--*))`，无新增 hex；存量 466 处 hex 收敛未做（后续债务） |
| ARCO-10 | ✅ | `Hero(Button\|Input\|Chip\|Card)` 两端 grep=0；35 处 HeroButton 调用（含 closing tag）改为语义包装名 + variant/size 属性；死 class 字符串归零；`arco.tsx` 包装层删除 legacy class 解析 |
| ARCO-11 | ✅ | `design.md`（范围/§10.1/§10.4/§13）、`ADR-002`（状态+决定2/3+2026-11-03 决策）、`docs/2026-10-31-arco-design-migration-plan.md` 状态均已按实际改写 |
| ARCO-12 | ✅ | 新增 `scripts/check-arco-styles.mjs` + `npm run check:arco-styles` + CI step；web 移除未使用 Breadcrumb 样式；当前 web 14/14、妙搭 13/13 组件均登记 |
| ARCO-13 | ✅ | `panels.test.tsx`/`App.test.tsx` 更新并新增 Checkbox、InputNumber、Tabs（Enter 切换）、更多筛选展开/收起用例；Web **106/106** 全绿；Select portal 断言使用 document 查询（复用 `chooseArcoOption`） |
| ARCO-14 | ✅ | Tailwind 定位：仅 preflight/reset + `@theme inline` 主题桥，不启用工具类布局；已写入 design.md/ADR-002 |
| ARCO-15/16 | ⏳ | P2 未做（Form/Form.Item、妙搭测试基线） |

### 7.1 ARCO-07 两端同字段一致性审计（脚本比对 `aria-label` + 组件类型）

- `panels.tsx`：共同字段 **42** 个；`App.tsx`：共同 **12** 个；`intake-form.tsx`：共同 **22** 个。
- 同名字段的组件类型差异仅剩"包装名 vs 直接 Arco"：web `Input`（arco.tsx 薄包装，内部渲染 `ArcoInput`）↔ 妙搭 `ArcoInput`；web `Button` ↔ 妙搭 `ArcoButton`；行为与 DOM 组件一致，属命名差异而非实现分叉。
- 顶部导航「帮助」已由妙搭 `<a>` 改为 `ArcoButton href`（与 web 一致，锚点语义由 ArcoButton 渲染）；`<a>` 文本链接豁免仍适用。

### 7.2 仍存的差异/缺口（不影响 ARCO-01~14 验收）

1. web 独有「连接自检」诊断面板（`panels.tsx` SelfCheck）与「批次开始/结束时间」筛选字段；妙搭无对应 UI——属既有功能差异，需产品决定是否补齐，不是组件分叉。
2. Arco `Tabs` 当前版本不渲染 `role="tablist"`（仅 tab/tabpanel），已用外层 `role="group"` + aria-label 标注；方向键切换/面板关联由 Arco 承担。若要严格 tablist 语义需升级/封装 Arco。
3. 原生 `<button>` 仍有少量（web 18 / 妙搭 19，均为 `.icon-button`/`.link-button`/`.audience-save-button` 等自定义文本按钮）；清单未列入 P0/P1，本轮未全量替换，登记为后续可选项（替换需同步校准 `.arco-btn` 与自定义类样式）。
4. 文案/字段仍以 web 与妙搭各自数据源为准；ARCO-07 只保证同义字段组件一致。

### 7.3 生产验证（2026-11-03，root `830dc38` / 妙搭 `4641ec2`，release `7703794419095850176`）

- release 状态 finished，commit `4641ec2`，`error_logs=[]`；线上冒烟无崩溃。
- 亮/暗主题切换正常：`body[arco-theme]` 随开关切换，Arco 控件与自定义变量同步（亮色截图 `/tmp/arco2-*.png`，暗色 `/tmp/arco-*.png`）。
- 团队管理、同步记录：Arco Tabs 渲染并可点击切换（人员/负责人映射、同步批次/审计日志）；审计筛选 3 个 Arco Input。
- 需求池：搜索 Input、3 个筛选 Select、更多筛选按钮 `aria-expanded=true` + `#requirement-more-filters` 区域出现（区域内 3 Select + 2 个原生 datetime-local 豁免）。
- 新建需求表单：3 个文本 Input + 3 个 Select（portal 展开 7 个渠道选项）+ 2 个 TextArea；控件宽度与字段容器一致（1036px 文本域），无原生 select。
- 需求详情：人工优先级/补充上下文区块可见；「编辑评分」展开后 10 个 Arco InputNumber + 1 个 Checkbox，无原生 number input。
- 数据源与计划：2 个 Arco Checkbox（同步/周计划）；优先级规则「高级设置」展开后 3 个 Arco InputNumber。
- 两端原生 `<select>`/`<details>` 为 0；原生 `<input>` 仅剩 2 处 `datetime-local` 豁免；`grep Hero*` = 0、死 class 字符串 = 0。

### 7.4 补充收尾（2026-11-03 第二轮：全部 UI 问题）

- **原生 `<button>` 全量 Arco 化**：两端 6 个页面文件中的全部原生按钮（web 18 / 妙搭 19）→ `ArcoButton`（`htmlType="button"`，保留 className/aria/ref/disabled）；两端 `<button` 计数 = 0。覆盖 icon-button、link-button、text-link、sidebar-backdrop、todo-card、audience-save-button、audience-ai-chip、audience-tag、feishu-user-option、owner-cell-button、req-owner-revert、req-audit-trigger。
- **ArcoButton 盒模型桥接**：新增 `ARCO-10` 桥接规则（`.arco-btn.icon-button`/`.link-button`/`.todo-card` 等重置 Arco 默认 height/padding/min-width），避免 Arco 默认尺寸破坏原布局。
- **ARCO-09 首轮收敛**：移除已定义变量上多余的 `var(--rq-*, #hex)` 回退值 72 处；新增 37 个语义色 token 并替换 74 处规则字面量；两文件组件规则 hex 从 462/463 降至 **232**（约 −50%）；剩余为一次性色值（按既有 token 策略保留）。
- **暗色 UI 修复**：原生 `datetime-local` 增加统一样式与 `color-scheme`（暗色下日期选择器/图标不再白底）；`.sidebar-backdrop` 显式 `display:block`。
- 生产验证（release `7703841253931109621`，commit `b224fa2`，`error_logs=[]`）：
  - 总览：`todo-card` 恢复 107px 卡片（含 warn/danger/info/ok 左侧 3px 色条）、icon 按钮 30×30、link 按钮 padding 4px 2px；亮/暗均正常。
  - 需求详情：`audience-save-button` 恢复品牌蓝底白字（rgb(43,97,216)），人群 chip 白底/蓝灰描边、选中态浅蓝底，`req-owner-revert` 恢复行内文本按钮。
  - 需求池「更多筛选」：亮色日期控件 h34、暗色下背景/文字/`color-scheme` 均切到暗色（浏览器日期图标不再白底）。
  - 两端 `button:not(.arco-btn)` = 0；`<button` 计数 = 0；按钮布局/尺寸截图见 `/tmp/ui5-*.png`。

- **响应式与移动端回归（2026-11-03，CDP 视口模拟 860/560）**：总览、需求池、团队管理、同步记录、数据源、优先级规则、功能模块均无横向溢出（`document.scrollWidth == innerWidth`）；需求池表格在 560 宽保留内部横向滚动；560 宽新建需求表单字段自动换行（两列/整行），删除确认弹窗 520×183 居中；移动端侧栏抽屉 + 全屏遮罩正常（`.sidebar-backdrop` 修复为 `position:fixed; inset:0`，实测 560×900，点击遮罩可关闭）。

- 相关提交：root `2156063`（按钮 Arco 化 + ARCO-09 首轮 + 暗色日期）→ `a66ebec`（盒模型桥接）→ `463851f`（custom 控件 text 类型）→ `f7dffde`（高优先级视觉桥接）；妙搭镜像 `1cc13a3` → `4af3b29` → `0802775` → `b224fa2`。


### 7.5 交互与移动端收尾（2026-11-04）

- **更多筛选浮层**：新增点击外部 / Escape 关闭（`click` 监听兼容键盘 Enter/Space 激活外部按钮），关闭后焦点回到「更多筛选」；打开「新建需求」等外部控件时浮层自动收起。
- **Arco Tabs 可访问性**：新增 `AccessibleTabs` 包装（团队管理 / 同步记录），挂载后在 `.arco-tabs-header` 上补 `role="tablist"` 与 `aria-label`，保留 Arco 生成的 tab↔tabpanel 关联；测试补充 `getByRole("tablist", { name })` 断言。
- **移动端宽表**：批次/审计表加 `scroll={{ x: 960/1040 }}`，需求池表格保留内部横向滚动；≤700px 时表格单元格 `white-space:nowrap + overflow:hidden + text-overflow:ellipsis`，不再出现「批 次 ID」「需 求 总 数」逐字换行或长 JSON 撑爆行高；实测 560 宽批次表滚动区 960 > 532、长批次 ID 以省略号截断。
- **移动端回归**：560/860 断点下各页面无横向页面溢出；侧栏抽屉遮罩 `position:fixed; inset:0`（560×900）；删除确认弹窗 520×183 居中；新建需求表单字段自动换行；亮/暗主题均复核。
- 提交与发布：root `97f65ed`/`b93d77c`/`697e1e1`/`b809e28`，妙搭 `8bd6c29`/`d76bf75`/`b9e8746`/`06b5d74`；最新 release `7704170906138414385`（commit `06b5d74`，`error_logs=[]`）。

