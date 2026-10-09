# [implemented-not-target-verified: 2026-10-09] 05 — 手动 Teambition 同步纵向切片

## 目标
让授权操作员从 Web 发起一次同步，并看到真实批次/需求状态及可诊断结果。

## 范围
- Web 手动触发指定产品组项目的首次全量同步和后续同步。
- 服务端分页读取并保存源快照，批次和逐条结果落库；展示执行中、成功、部分失败、失败。
- 以项目 ID + 需求 ID 幂等；导入无负责人需求；不写回 Teambition。
- 提供批次列表/详情的最小可用界面与安全、可操作的错误信息。

## 验收标准
- 重复触发不创建重复需求映射；并发重复批次有可靠互斥或安全策略。
- 字段映射只使用 Ticket 01 已验证的来源，不推断缺失字段。
- 单条错误不回滚已成功记录，批次汇总准确。
- Web 页面状态来自服务端持久记录，而非 mock 数据。

## Blocked by
Target Miaoda API/database runtime and verified identity provider remain blocked by Tickets 00/10/11; source field gaps remain tracked in Ticket 01. The UI component decision D-08 is resolved (HeroUI v3), but platform hosting compatibility is still pending Ticket 00.

## Local implementation evidence (2026-10-09)
- Implemented API-backed sources, manual sync enqueue, persisted batches/items, idempotent sync runner, Teambition gateway adapter and requirement workbench views in the actual GitHub checkout (`main`, `ef9a288`).
- This is **not yet** the production/manual Teambition sync vertical slice: the deployed Miaoda app contains only its scaffold shell, no env variables or source config exist in its dev environment, no sync request was sent, and no target API/identity path has been verified.
- Added regression coverage for duplicate allowlisted Teambition custom-field IDs (last returned value is used consistently in the mapped domain projection and stored allowlist snapshot), unmapped-field exclusion, and malformed JSON fail-closed behavior.
- Verification: API 170/170, Web 13/13, typecheck, build and `git diff --check` pass. No target Miaoda RQ-Sys API was exercised; the current released app commit is still scaffold UI, and external credentials/identity are not configured.

## Evidence log
- 2026-10-09 — focused normalizer regression tests passed 3/3; full local suite API 170/170 and Web 13/13 passed; typecheck/build/diff-check passed.
- 2026-10-09 — read-only Miaoda check: dev schema exists, but source_configs has no source row; app dev environment variable list is empty. No Teambition sync request was sent from the app.
