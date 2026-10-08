# AI 分析 POC 实测记录（Ticket 03）

> 实测日期：2026-10-08。全部操作通过零依赖 Node ESM 脚本在本机完成；模型端点为 DeepSeek 开放平台。
> 对应工单：`.scratch/rq-sys-mvp/issues/03-ai-provider-poc.md`；决策登记：`specs/rq-sys-mvp/OPEN-DECISIONS.md` D-06。

## 前置决策（D-06，2026-10-08 已确认）

- **Provider**：DeepSeek，MVP 首选；通过 [OI] 兼容端点调用，JSON Output + 服务端 schema/枚举校验，adapter 保持可替换。
- **数据策略**：商业 API 标准口径——国内区域、服务商默认留存（KV cache 用户隔离、不用后自动清空）、业务审计在应用侧 PostgreSQL。依据个人信息收集清单（修订 2025-12-22），模型训练用途仅限 C 端智能对话，开放平台 API 输入未列入。
- **凭证**：服务端环境变量 `AI_API_KEY`，永不打印/回显，不进入浏览器构建产物。

## 实测环境

| 对象 | 值 |
|------|-----|
| 模型 | `deepseek-flash`（POC 默认；`deepseek-v4-pro` 未实测） |
| 端点 | `https://api.deepseek.com`（[OI] 兼容，`response_format={'type':'json_object'}`） |
| POC 脚本 | `.scratch/rq-sys-mvp/poc/ai-analysis-poc.mjs`（原生 fetch + AbortController，零依赖） |
| 运行结果 | `.scratch/rq-sys-mvp/poc/results/`（summary.json + 逐用例结果 + 出站载荷） |
| 测试 key | 环境现有 `AI_API_KEY` 无效（DeepSeek 401，key 尾号 df18）；有效 key 由用户晚点提供，T1–T3 待补跑 |
| 模块词典 | POC 测试词典 `test-dict-v1`：基础数据/数据可视化/报表分析/权限管理/集成对接 + fallback 其他/待分类 |

## 输入最小化与 PII 掩码（实测）

Spec 02 禁止发送姓名、用户 ID、联系方式。POC 在 `buildOutboundPayload` 中实现两层掩码：

1. **`pii_markers` 列表替换**：测试需求中列出的任意 PII 原文（含姓名「张三」这类非结构化值）在出站前统一替换为「（已掩码）」。
2. **正则兜底**：手机号（`1[3-9]\d{9}`）→「（手机号已掩码）」、邮箱 →「（邮箱已掩码）」，覆盖未列入 markers 的格式化值。

出站载荷自检（`assert_no_raw_pii`）：对掩码后的 user 文本断言不含任何 marker 原文。实测结果：

```json
{"ok":true,"violations":[]}
```

修复记录：初版仅正则掩码手机号/邮箱，姓名「张三」原样进入出站载荷（`assert_no_raw_pii.ok=false`，violations=["张三"]）；加入 markers 列表替换后断言通过。**结论：Pii 断言必须以出站载荷全文为基准，不能只依赖格式化正则。**

附件正文不进入模型请求（描述中仅保留「附件里有现阶段的整理模板」的引用性文字）。

## 已实测

### 1. 离线校验器（Spec 02 输出契约，5/5 通过）

| 用例 | 验证点 | 结果 |
|------|--------|------|
| O1_empty_content | JSON Output 空内容（官方已知问题）按分析失败处理，不伪装成功 | ✅ |
| O2_out_of_range_enum | module 不在词典/降级集合、confidence 非 高/中/低 → 拒绝 | ✅ |
| O3_priority_without_rule | 规则版本未发布（null）时输出 P0–P3 → 拒绝，必须为 null | ✅ |
| O4_inference_not_labeled | facts 区分内未带 `ai_inference: true` 的推断 → 拒绝 | ✅ |
| O5_http_error_classification | 401/403→auth_error、429→rate_limited、5xx→provider_error | ✅（真实 429 未触发） |

### 2. 在线实测（DeepSeek 真实端点）

| 场景 | 结果 |
|------|------|
| 无效 key 调用（T5） | ✅ HTTP 401 → `auth_error` 分类正确；provider 错误消息中 key 被掩码为 `****df18`，本地 `sanitize()` 确保完整 key 不出现在任何落盘输出 |
| 网络可达性 | ✅ 本机到 `api.deepseek.com` 可达，401 延迟 71–312ms（401 属快速业务拒绝，证明 TLS/网络链路通畅） |
| 客户端超时（T4） | ✅ 无参 `AbortController.abort()` → fetch reject `AbortError` → 分类为 `timeout` |
| 正常/低证据/freeform（T1–T3） | ⏸ 现有 key 无效（401），等待有效测试 key 补跑 |

超时实现注记：`controller.abort(reason)` 传入自定义 reason 时 fetch 会 reject 该 reason（name='Error'），分类器无法识别；必须用无参 `abort()` 才能拿到 `AbortError`。生产 adapter 直接按无参 abort 实现。

### 3. 每次分析的版本可记录（provenance）

每条结果（含失败）均带 provenance：`model` / `prompt_version`（poc-prompt-v1 / poc-prompt-freeform）/ `dictionary_version`（test-dict-v1）/ `rule_version`（null）/ `generated_at` / `attempt` / `retry_of`。满足工单验收标准「分析版本可记录模型、prompt、模块字典和规则版本」。

## 错误分类矩阵（实测 + 复核）

| HTTP | 分类 | 动作 |
|------|------|------|
| 401/403 | `auth_error` | 不重试；提示检查 `AI_API_KEY` |
| 429 | `rate_limited` | 退避重试（POC 未触发真实 429） |
| 5xx | `provider_error` | 重试 |
| 其他 4xx | `request_error` | 不重试；检查请求 |
| 客户端 abort | `timeout` | 非阻塞重试（工单验收：超时重试不阻塞首次结果） |
| 网络异常 | `network_error` | 重试 |
| 空 content / 非法 JSON / 越界枚举 | `analysis_failure` | 标记失败待重试，不伪装成功 |

## 尚未验证

- **T1/T2/T3（正常充足证据 / 低证据 / freeform 无效结构）**：等待有效 DeepSeek 测试 key；这是工单 03 验收「验证结构化输出」的剩余部分。
- 妙搭运行时对 DeepSeek 端点的可达性与出网策略（工单 00 未解除）。
- 真实 429 限流响应与退避行为。
- JSON Output 空 content 的真实复现（处理逻辑已由 O1 离线覆盖）。
- `deepseek-v4-pro` 的行为与限流（并发 500 vs flash 并发 2500）。

## 对后续工单的影响

- **Ticket 06（AI 分析纵向切片）**：provider adapter 按 POC 的 `callModel` / `validateAnalysis` / `classifyHttpError` 结构实现；`assert_no_raw_pii` 作为提交前门禁（断言失败不出站）；掩码采用 markers 列表 + 正则兜底两层。06 的解锁条件包含 03「获批并验证」，T1–T3 补跑通过后该条件才完全满足。
- **数据策略落地**：分析审计（provenance、请求摘要、失败分类）落应用侧 PostgreSQL（`analysis_runs` 表，见 `DB-AND-API-DESIGN.md`），不在 Base 记录 provider 原始响应。
- **prompt 版本管理**：`PROMPT_VERSION` 纳入配置而非硬编码；词典版本随 `module_dictionary_versions` 表演进。
