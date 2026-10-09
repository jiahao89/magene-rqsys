# [done: 2026-10-09] 03 — 确认 AI 服务与数据策略并验证结构化输出

## 目标
在获批模型服务和数据策略后，验证 Spec 02 的最小分析契约可以稳定实现。

## 前置决策
组织需确认模型服务、密钥来源、数据区域/保留/训练政策与允许发送的字段。不得将未脱敏个人信息或附件正文提交模型。

## 范围
- 用最小化、脱敏的需求字段验证受控模块建议、整体高/中/低置信度及理由/证据、U/M/S/C 维度建议的结构化输出。
- 验证无效 JSON/越界枚举/证据不足、超时、限流、服务错误的处理。
- 验证每次分析版本可记录模型、prompt、模块字典和（如已发布）规则版本。

## 验收标准
- 记录获批服务及数据策略，不将个人敏感信息或附件内容发送给模型。
- 输出可按 Spec 02 schema 校验；不能校验的结果标记失败，不伪装为成功。
- 置信度仅为单条需求整体高/中/低，带总体理由和证据；优先级规则未发布时 P0–P3 留空。
- 分析失败或低置信度不阻止推送，超时后的重试不阻塞首次结果进入后续推送。

## 依赖/状态
D-06 已于 2026-10-08 确认（详见 OPEN-DECISIONS.md）：
- Provider：DeepSeek，MVP 首选；通过 [OI] 兼容端点调用，JSON Output + 服务端 schema/枚举校验，adapter 保持可替换。
- 数据策略：商业 API 标准口径——国内区域、服务商默认留存（KV cache 用户隔离、自动清空）、业务审计在应用侧 PostgreSQL；依据个人信息收集清单（修订 2025-12-22），模型训练用途仅限 C 端智能对话，开放平台 API 输入未列入。
- 凭证：服务端环境变量 `AI_API_KEY`，永不打印/回显，不进入浏览器构建产物。

本票拆为 provider adapter（决策已解锁）和分析实现（依赖 05）。POC 部分验证完成（2026-10-08，证据：`specs/rq-sys-mvp/AI-ANALYSIS-POC.md`）：离线校验器 5/5 通过（空内容/越界枚举/无规则优先级/推断未标记/错误分类）；在线实测通过无效 key 401 → auth_error（key 不泄露）、网络可达（401 延迟 71–312ms）、客户端超时分类；PII 掩码断言通过（markers 列表替换姓名 + 正则兜底手机号/邮箱，出站载荷零 marker 原文）。妙搭运行时对 DeepSeek 端点的可达性留待目标环境验证（工单 00）。

## 有效 key 补跑与生产适配器验证（2026-10-09）
- 用户提供有效测试 key（仅存 `.env`，gitignored，不提交不回显）。**T1/T2/T3 全部 PASS**：T1 正常充分证据 → 合法结构化输出（module 命中词典、confidence 高、U/M/S/C 证据/缺失标注规范、priority null）；T2 低证据 → 待分类/低置信 + 缺失信息呈现、无编造事实；T3 freeform 非 JSON → 校验器拒绝为 analysis_failure。离线 O1–O5 复跑仍 PASS；T4 超时/T5 无效 key 保持 PASS。POC 10/10 通过。
- **生产适配器（apps/api）冒烟通过**并修复三个集成缺陷：
  1. `createDeepSeekProvider` 工厂读取空环境对象 `{}`，永远拿不到 env 凭证 → 修复为 `getAiProviderConfig()`（默认 process.env）。
  2. 生产提示词缺少精确 JSON 样例 → 模型输出结构错位（evidence 给字符串、missing_evidence 给数组）→ 修复为与 AnalysisSchema 一致的完整样例 + 约束说明（对齐 POC 提示词风格）。
  3. 校验失败原因被吞掉 → 修复为携带可诊断 detail（zod issues/原文断言失败原因）入 safe error。
- 环境注意：shell profile（`~/.zshrc`）曾导出旧 `AI_API_KEY`——实为阿里云 DashScope key（尾号 df18，非 DeepSeek key），挂在通用变量名下遮蔽 `.env` 中的新 DeepSeek key（Node `--env-file` 不覆盖已存在环境变量）。**已清理（2026-10-09）**：该行已从 `.zshrc` 移除并留说明注释，隔离登录 shell 验证通过；若仍需 DashScope 请改用 `DASHSCOPE_API_KEY` 重导出。当前 TRAE 会话仍继承旧变量直至重启，会话内 AI 验证暂需 `env -u AI_API_KEY`。
- 边界：以上为本地脚本与生产适配器（注入 fetch）验证；妙搭运行时外呼仍待工单 00。
