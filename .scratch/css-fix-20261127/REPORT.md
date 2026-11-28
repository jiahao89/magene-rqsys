# 两处 CSS 回归修复（暗色画布 / 1000px 表格）

- 日期：2026-11-27
- 提交：根仓 `ad28caa`（待推，本机 `git push` 网络中断）、妙搭 `750d899`（已推 `d04b7bd..750d899`）
- 范围：只动 `styles.css` 与两条样式守卫用例；未改 JSX、未改业务逻辑
- 基线：`3e6af75` / `d04b7bd`（release `7712662784915541259`）

## 1. 暗色画布（P1）

**根因**：`--rq-*` 别名声明在 `:root`，而 Arco 的 `--color-*` / `--primary-*` / `--border-radius-*`
只声明在 `body[arco-theme]` 上，`:root` 处取不到值，整条 `background: var(--rq-canvas)` 失效 →
画布透明 → 露出浏览器白底。亮色下白底与浅灰画布接近，暗色下就是「白底 + 黑表格」。
另外暗色 `--color-fill-2` 是 `rgba(255,255,255,.08)` 半透明白，直接当画布色也会叠成灰白。

**改法**：
- `--rq-*` 别名整块从 `:root` 迁到 `body`（同名 token 在 body 上才能解析；暗色覆盖也作用在 body 上，随主题生效）。
- 删除 `--rq-canvas` 这层间接，画布直接写在 `body`：亮色 `var(--color-fill-2)`，暗色 `body[arco-theme="dark"] { background: var(--color-bg-1) }`（深色底）。
- `.app-shell` / `.main-area-layout` 不再各自画一层画布，避免暗色半透明填充叠加。

**实测（1440×900）**：

| 状态 | 修复前 body 计算背景 | 修复后 |
|---|---|---|
| 亮色 | `rgba(0, 0, 0, 0)`（透明→白） | `rgb(242, 243, 245)` |
| 暗色 | `rgba(0, 0, 0, 0)`（透明→白） | `rgb(23, 23, 26)`（`--color-bg-1`） |

卡片暗色保持 `rgb(35, 35, 36)`（`--color-bg-2`），表格/侧栏/顶栏未受影响。

## 2. 1000px 表格右侧列（P1）

**冒烟报告的三个数字（`.table-scroll` 1170、操作列表头 x=1306、右界 1426）在 1000 宽下复现不出来**，
它们与 1467 视口完全吻合（1467 − 侧栏 215 − 内边距 = 1170；1170 + 256 − 120 = 1306）。
真实 1000 宽下：内容区 785 → 卡片 737 → 表格容器 **703**，父级 flex/grid 容器宽度都已被正确约束
（逐层实测 `main-area-layout` 785、`content-area` 785、`card-body` 735、`table-scroll` 703，均无 `min-width: auto` 溢出）。

**真实问题**：表格带 `scroll.x` 时 Arco 自己包了两层滚动容器
（`.arco-table-content-scroll` + `.arco-table-content-inner`），横向滚动发生在内层；
外层 `.table-scroll` 也写了 `overflow-x: auto` 但永远不会滚，内层滚动条在 macOS 上又是覆盖式的、静止时不显示，
所以右侧列看起来像被直接裁掉、也没有可发现的滚动入口。

**改法**（最小改动，不动 Arco 内部结构）：
- `.table-scroll` 补 `max-width: 100%; min-width: 0`，保证外层始终等于内容区宽度、不被内容撑宽；
- 给 Arco 的横向滚动层 `.arco-table-content-inner` 一条常驻可见的细滚动条（`scrollbar-width/color` + `::-webkit-scrollbar`），
  让「可以横向滚」变成看得见的入口。

**实测（1000×900，需求池）**：
- 表格滚动容器 `clientWidth=703`、`scrollWidth=1100`，可滚 `397px`；
- 滚到最右后「操作」列表头 `left=839 / right=959`，完整落在视口内，行内「分配」按钮可点；
- 页面 `documentElement.scrollWidth=1000`，无整页横向溢出；
- 我的需求页同样：`703 → 1120`，可滚 `417px`，操作列右界 `939`。

## 3. 门禁

| 检查 | 结果 |
|---|---|
| 根仓 web 单测 | **263/263**（含更新后的 Target B 样式守卫） |
| 根仓 typecheck / build | 通过 |
| `check:arco-styles` | 通过（35/35 组件登记） |
| `check:alignment` | 12/12 共用文件一致，无未声明漂移 |
| `git diff --check` | 通过 |
| 妙搭 client 测试 | **29/29** |
| 妙搭 client typecheck / build | 通过 |
| 两仓 `styles.css` | 逐字一致（commit 内容比对通过） |

## 4. 证据

- `fix-1440-light.png` — 1440 亮色，六列齐全、画布浅灰
- `fix-1440-dark.png` — 1440 暗色，画布 `#17171a`、卡片 `#232324`
- `fix-1000-light-rest.png` — 1000 亮色静止态（右侧列需横向滚动）
- `fix-1000-light-scrolled.png` — 1000 亮色滚到最右，「处理状态 / 更新时间 / 操作」可见
- `fix-1000-dark-rest.png` — 1000 暗色静止态
- `fix-1000-my-requirements-scrolled.png` — 我的需求页 1000 宽滚到最右

## 5. 备注

- 工作区里另有一批**未提交**的 UI 打磨（工具栏布局等，上一轮未收尾），**没有**带进这次补丁；
  已在本地复验：样式 + 该打磨同时存在时 typecheck 与 263 条单测仍全过，但该打磨本身尚未验收，未提交。
- 根仓 `ad28caa` 推送失败（`Connection reset by peer`），需由有推送权限的会话推送并跑 CI。
