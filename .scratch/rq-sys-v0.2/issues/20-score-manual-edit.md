# 20: PM修改单项评分与α

**What to build:** 提供评分编辑API：PM可修改九项输入和α，服务端重算综合分/P，形成确认版本并审计；支持AI建议与当前值分离、显式采用AI、乐观并发和失败隔离。

**Blocked by:** 19（评分契约/计算/版本）

**Status:** target-verified（2026-10-28：PUT/apply-ai、409冲突、版本/审计/人工不改推送已验证；release 7701533977702993200 / 57db23d）

**Approval:** 用户于2026-10-27确认PM可修改单项评分和α。

**Spec:** [V02-S06](../../../specs/rq-sys-v0.2/06-ai-scoring-and-priority.md)

**Execution gate:** 本地实现可进行；目标写入/验收由T22按G-DEPLOY执行。

## Acceptance criteria

- [ ] V02-T20-AC01：`PUT /api/requirements/{id}/scoring`接受`{expectedVersion,inputs,alpha,safetyFlag?,reason}`；校验范围/整数/α步长/九项完整；服务端重算并保存确认版本；非法返回400，需求不存在404。
- [ ] V02-T20-AC02：以version做乐观并发控制；冲突返回409并携带当前版本，不覆盖旧版本；客户端重试后可成功。
- [ ] V02-T20-AC03：每版记录actor、时间、from/to版本、修改前/后输入、α、综合分、P、理由；审计`scoring.updated`；人工版本origin=manual/confirmed，旧current变superseded，current指针更新。
- [ ] V02-T20-AC04：`POST /api/requirements/{id}/scoring/apply-ai`按指定有效AI建议生成origin=ai_applied的确认版本；不能采用其他需求/已失效建议；冲突409。
- [ ] V02-T20-AC05：AI建议与当前人工值分开保存；AI重跑不覆盖人工当前值；未确认AI建议可被采用或忽略；不出现静默改优先级。
- [ ] V02-T20-AC06：人工编辑不自动推Base、不重置PM状态、不发通知、不启动Kano/RICE；评分版本只读历史。
- [ ] V02-T20-AC07：权限沿用“任何已登录租户用户”；actor只取服务端可信身份；审计不记录敏感原文。
- [ ] V02-T20-AC08：API/OpenAPI、仓储、集成测试、两仓对齐通过；覆盖并发、非法输入、采用AI、失败隔离。

## Verification

本地：HTTP/集成测试（保存/重算/409/404/400/apply-ai/审计/当前指针）、两仓契约对齐。目标：T22用受控合成需求验证人工修改和版本审计。

## 2026-10-28 本地实施记录

- `PUT /api/requirements/{id}/scoring` 与 `POST /api/requirements/{id}/scoring/apply-ai`；服务端重算、期望版本409、审计、AI/人工分离、采用AI。
- 人工编辑不自动推Base/通知，不启动Beta；权限沿用已登录租户用户。
- HTTP、仓储、OpenAPI及两仓类型/路由测试通过；目标未写入。
