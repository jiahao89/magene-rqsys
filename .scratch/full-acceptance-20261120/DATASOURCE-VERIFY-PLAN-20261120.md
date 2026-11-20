# 数据源页（多维表格收集表三块）验收清单

- 日期：2026-11-20
- 前置：前端 `5263102` + 后端 `shareUrl`/`lastError` 脱敏 + PRD §4.11 一起发版；`BASE_FORM_SHARE_URL` 已在 dev/online 配置
- 发版前基线（已取）：`/api/ops/metrics` → `metrics.baseForm` = `{lastRunAt:"2026-11-20T09:16:32.488Z", pages:1, scanned:0, skipped:0, created:0, recorded:0, rejected:0, writeBackFailed:0, readFailed:false, lastError:null}`，**无 `shareUrl` 键**（代码未上线）
- 基线数据：App 334/333/0/1/0、评估 0、PM 334、收集表 0

## 判据（PRD §4.11 DS1–DS6）

| # | 检查 | 预期 | 方式 |
|---|---|---|---|
| DS1 | 卡片位置与只读 | 「多维表格需求收集表」在「连接与数据源」下方；无输入框、无保存按钮 | 线上页面 |
| DS2 | 来源地址 | 完整 URL 文本 + 「复制链接」；点复制后显示「已复制」；备注「需在本租户内登录飞书后访问」；URL 不可编辑 | 线上 + 剪贴板读取 |
| DS3 | 未配置地址 | 整行隐藏，不出现「未配置」占位，不出现空链接 | 单测 / 拦截响应（线上不便改环境变量） |
| DS4 | 同步规则 | 固定文案含「每 30 分钟」「Asia/Shanghai」「提交不等于立即进池」；**没有**立即同步/重试/暂停按钮 | 线上页面 |
| DS5 | 最近一次同步 | 最后运行时间、扫描、新建、校验失败、写回失败、读取失败、最后错误；0 显示 0；`lastRunAt=null` 显示「尚未运行」；统计缺失显示「同步统计暂不可用」 | 线上（真实值）+ 单测（null/缺失分支） |
| DS6 | 不暴露内部信息 | 页面文本无 `tbl…`/`rec…`/`fld…` 形态 ID，无表/记录链接，无 token、无 `BASE_INTAKE_TABLE_ID`；`lastError` 只显示类别摘要且 `rec…`/`tbl…` 已掩码 | 线上 + 接口 JSON 扫描 |
| DS7 | 降级不影响上方配置 | metrics 503 时：「连接与数据源」正常可读，三块只隐藏数字/显示暂不可用，不弹错 | 单测（191/191 含该用例）+ 视图确认不打印栈 |

## 泄漏扫描口径

- 正例：`rec[a-zA-Z0-9]{8,}`、`tbl[a-zA-Z0-9]{8,}`、`fld[a-zA-Z0-9]{8,}`、`https://aimagene.feishu.cn/base/...?table=`
- 反例（误报）：`recorded` 含 `rec` 不算泄漏——按上面带长度后缀的正则判

## 执行顺序（发版后）

1. 取 `/api/ops/metrics`，确认 `metrics.baseForm.shareUrl` 存在且等于配置值；扫描 JSON 无 `tbl/rec/fld` 形态 ID
2. 打开「数据源与计划」，逐项过 DS1/DS2/DS4/DS5/DS6；截图存档
3. 点「复制链接」，读剪贴板确认内容与展示一致
4. 确认页面上没有任何可编辑地址的控件、没有同步触发按钮
5. DS3/DS7 若无法在线上构造（需改环境变量或注入 503），按单测覆盖记录，不谎报线上 PASS

## 证据文件

- `ds-01-page.png`（三块整体）
- `ds-02-copied.png`（复制成功态）
- `ds-03-metrics.json`（接口原文，脱敏后）
