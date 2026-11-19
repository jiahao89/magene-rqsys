# 聊天抽取 20 段回归 harness

配套 [SAMPLES-20261119.md](SAMPLES-20261119.md)，用于 PRD-26 5a 的抽取质量回归。默认只跑本地桩，**不调线上、不写库、不产生 `intake.*` 审计**。

## 为什么先跑桩

线上每跑一段（成功或失败）都会写一条 `intake.*` 审计，20 段会把 `chatIntake` 从 `0/0` 涨到 20 左右；清理流程现已就绪，但默认仍先跑桩验证 harness，正式跑完按样本文档 §3 删除本轮审计并复查归零。

## 用法

```bash
cd .scratch/ai-intake-samples

# 1) 只校验样本与标注：20 段、总表一致、枚举/模块词典对得上
node run-intake-samples.mjs --check --modules-file module-dictionary-live.json

# 2) 本地桩跑通：起 127.0.0.1 假端点，验证解析、打分、报告链路
node run-intake-samples.mjs --mode stub --assert-stub --modules-file module-dictionary-live.json

# 3) 只跑指定样本（桩或线上都可）
node run-intake-samples.mjs --mode stub --only S01,S02 --modules-file module-dictionary-live.json

# 4) 线上复跑：必须显式确认审计写入；用线上已发布词典做模块基线
export INTAKE_COOKIE='<登录 Cookie>'   # 或 INTAKE_AUTHORIZATION
export INTAKE_CSRF_TOKEN='<suda-csrf-token>'
node run-intake-samples.mjs --mode live \
  --allow-live --ack-audit-writes \
  --base-url https://ecn8egz1lhkq.feishuapp.com/app/app_17fqkjwyx1u \
  --modules-file module-dictionary-live.json \
  --delay 30000 --gate
```

`module-dictionary-live.json` 是线上 v7 词典快照（`{version, names:[...]}`）；也可以直接传 `GET /api/modules` 的原始返回（`{version, items:[{name}]}`）或名称数组。标注和模型都应以这份线上词典为准；不传时退回 `0003` 种子，只适合离线自检。

`--gate` 按验收门槛输出 PASS/FAIL，失败时进程退出码为 1：

- 20 段全部成功计分（无 HTTP 错误、无 fallback）；任一段 429/失败，整轮 FAIL，不接受缩水后的 68 分母
- 正向字段精确匹配 ≥80%，即 **≥58/72**（18 个正向样本 × 4 个字段，最多 14 个字段错）
- 负向 2/2
- PII 泄漏 0
- 约束缺失 ≤3
- 提出人错误 ≤1

同时报告**空值率**（实际 null 占四个硬字段的比例）和「不该空却空」的数量，避免靠全填 null 刷分。

结果写到 `results/<mode>-<时间>.json|.md`；控制台同时打印逐段结果和汇总。

> 桩模式验证的是 harness 的解析、打分、报告链路，桩返回的是按契约手工构造的响应；真实 `intake-draft` 路由的行为由 `apps/api/src/http/app.test.ts` 覆盖，线上跑数仍以真实响应为准。

## 判分口径

- **四个硬字段**：渠道（`sourceChannel`）、类型（`requirementType`）、模块（`intakeModule`）、提出人（`proposer`）精确匹配；标注为 `null` 时，模型返回任何值都算错（不猜、不补造）。
- **fallback**：`fallback: true` 的样本要人工改写，字段不计入准确率；单独统计 fallback 率。
- **负向/混合样本**：S11、S20 单列，不混入正向分母；两项都通过才算负向通过。
- **PII**：从原始聊天里提取手机号、邮箱、订单号、微信号，检查返回的标题/描述/约束/型号/提出人里是否原样出现；命中即泄漏。报告里对命中的值做 `***` 脱敏。
- **约束**：标注为 `null` 但返回了内容 → 记「编造」；有标注但返回为空 → 记「缺失」；其余检查标注里的数字/型号锚点是否覆盖，语义是否覆盖仍需人工。结果里 `语义待人工` 不是失败。
- **标题/描述**：只自动检查非空、长度上限、是否含 PII；主诉求、错别字、闲聊混杂等仍需人工按样本标注复核。

## 桩的预期结果（用于自检）

`--assert-stub` 会断言下面这组已知结果，证明 harness 真能抓错：

| 项 | 预期 | 说明 |
|---|---|---|
| 正向字段 | **65/68（95.6%）** | 桩故意写错 S02 模块、S03 渠道、S19 提出人 |
| 负向样本 | **0/2** | S11 被塞了类型、S20 被猜了渠道 |
| fallback | **1（S09）** | 字段不计分 |
| PII 泄漏 | **1（S16）** | 桩在描述里塞了邮箱 |
| HTTP 错误 | 0 | — |

桩的固定错误在 `run-intake-samples.mjs` 的 `STUB_MUTATIONS` / `S09` 分支里：S02 编造「电源管理（海信新平台）」、S03 写成终端用户、S11 硬造「体验优化」、S16 描述带邮箱、S19 把研究员小林当提出人、S20 猜终端用户、S09 走 fallback。换真实模型跑时不要改这些，桩结果只用于验证 harness 本身。

## 线上跑之前

- 20 段按 3 次/分钟限流至少 10 分钟，默认 `--delay 30000`；S09 上次就是 21 秒间隔撞 429，不要为跑样本改线上限流。
- 正式复跑必须带 `--modules-file`（`GET /api/modules` 的线上快照）；`0003` 种子与线上已发布词典可能不一致。
- 正式复跑带 `--gate`；报告会记录样本 sha256 和词典版本，便于和上一轮精确对比。
- 每段成功/失败都会写 `intake.*` 审计；跑完按样本文档 §3 删除本轮审计行，并复查今日 `intake.*` 归零。
- 只调 `intake-draft`，不要创建需求；若误建，按 5a 的 L 流程清应用库和 Base 两侧。
- 真实聊天替换样本前必须先脱敏并取得授权；harness 只接受当前虚构样本。

## 文件

- `run-intake-samples.mjs`：解析、校验、本地桩、打分、报告、live 客户端（带写入确认锁）。
- `SAMPLES-20261119.md`：20 段样本与标注（软件产品维护）。
- `results/`：每次运行的 JSON + Markdown 报告。
