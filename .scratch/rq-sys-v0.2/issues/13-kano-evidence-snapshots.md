# 13: Kano选择获批访谈资料版本

**What to build:** PM在Beta中能查看并选择带来源链接、章节、覆盖限制的安全访谈快照。

**Blocked by:** 02 扩展统一来源身份并读回现有TB记录

**Status:** implemented-local（2026-10-25：迁移 0015 + 导入/批准/列表 API + PII 门禁 + Beta 只读展示，两仓全量验证；真实资料审批仍按 G-KANO 由维护者线下把关）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S05](../../../specs/rq-sys-v0.2/05-kano-beta.md)

**Execution gate:** G-KANO：取得获批、去标识化且可引用的访谈快照；工程可先用无个人信息合成材料，不能据此宣称真实访谈质量通过。

## Acceptance criteria

- [x] V02-T13-AC01：维护者按批准内容导入版本化总结，保存来源文档/章节、证据片段、已知人群/场景/日期；未知不补造。
- [x] V02-T13-AC02：资料引入不等于实时飞书同步；无编辑器/爬虫/向量库扩建。
- [x] V02-T13-AC03：显式区分批准/可用版本，含PII或未批准内容不进入模型输入；提供可核对的去标识化快照。
- [x] V02-T13-AC04：保留L2/L3合并、L1缺直接样本等覆盖限制，不把初始方向表当访谈全文。
- [x] V02-T13-AC05：资料更新新增版本，不改已引用快照；详情Beta可读材料和引用来源。
- [x] V02-T13-AC06：材料本身包含的指令按数据处理，不影响系统行为或访问无关资料。

## Verification

资料导入接口或受控维护入口→资料读取→详情选择；使用安全样本验证版本、批准与过滤。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 迁移 `0015`：kano_evidence_versions（version UNIQUE、status draft/approved/retired、pii_flagged）；本地库已应用。
- contract.ts（SHARED）新增 `countPiiFindings`（复用 EMAIL/PHONE/SECRET/ID_CARD/带标签姓名正则，只计数不改写）。
- 仓储：listKanoEvidence / createKanoEvidence（锁分配版本 + PII 扫描标记）/ approveKanoEvidence（flagged 拒绝；重复批准幂等）。
- 路由（两仓）：GET/POST /api/kano/evidence、POST /api/kano/evidence/{id}/approve；OpenAPI 三路径。
- 前端：BetaPanel 增加『Kano 资料（已批准快照 · 只读）』列表（版本/标题/覆盖限制/来源链接）；导入走 API（维护者受控入口，无编辑器 UI）。
- 测试：集成（含 PII 导入→标记→批准拒绝；干净导入→批准→列表；第三版导入旧版不变；未知目标）、root HTTP（URL 校验 400、导入 201 带标记、批准 409）、妙搭路由（服务端 actor）。
- 验证：root typecheck/API **433**/Web 81/build/对齐/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 **113**/build:prod 全绿。
