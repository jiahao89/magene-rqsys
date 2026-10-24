# 05: 补齐精简需求上下文并展示来源

**What to build:** 手工需求可选保存产品型号、需求类型、限制、补充说明与来源链接，后续处理只消费批准的上下文。

**Blocked by:** 04 最小新建需求贯通AI与Base

**Status:** implemented-local（2026-10-25：迁移 0010 + 契约/路由/表单可选字段 + 批准上下文进安全输入 + 详情读回，两仓全量验证）

**Approval:** 用户于 2026-10-23 确认拆分；按前置任务和下列 Execution gate 领取。

**Spec:** [V02-S00](../../../specs/rq-sys-v0.2/00-unified-requirement-foundation.md)、[V02-S01](../../../specs/rq-sys-v0.2/01-manual-intake-and-edit.md)

**Execution gate:** 无额外产品门槛；目标环境写入仍遵守项目授权门禁。

## Acceptance criteria

- [x] V02-T05-AC01：最小表单之外按PRD提供可选字段，未知留空，不自动补造产品/型号/限制。
- [x] V02-T05-AC02：渠道和需求类型使用已定义固定类别，来源类型与业务渠道分开；无渠道管理后台。
- [x] V02-T05-AC03：详情读回用户原始输入，来源链接不冒充TB地址，标签/来源筛选及现有分页口径正常。
- [x] V02-T05-AC04：人工录入类型保留，与后续AI建议分开；来源事实只投影获批列，不扩为28字段。
- [x] V02-T05-AC05：批准上下文进入安全输入构造；个人信息、附件、身份和带敏感参数链接不原样发送模型。
- [x] V02-T05-AC06：只在受控字段映射存在且类型已核对时投影Base；不随意省略核心需求定义或悄悄创建新列。

## Verification

新建→详情→主分析有效载荷→Base投影行为验证，覆盖全空可选值和含PII文本。

新增/更改行为须在本切片完成本地验证，并同步两仓契约与必要实现；目标环境未执行时标记“已实现，未在目标环境验证”。不将全部测试或双仓同步拖到最终验收票。

## 2026-10-25 实施记录

- 迁移 `0010`：product_model/requirement_type（DDL 八类 CHECK）/constraint_notes/supplement_url，本地库已应用。
- 契约/路由：RequirementIntakeSchema 可选上下文（zod url/枚举校验）；POST 透传；详情 DTO 加法返回四字段；OpenAPI 同步（并补齐 T02 遗漏未落库的 Requirement schema sourceType/sourceChannel 段）。
- 安全输入：analysis/context.ts（SHARED）纳入产品/边界；类型与链接不发送模型。
- 前端：IntakeForm 四个可选输入（两仓）；详情 L1『录入上下文』区块。
- 测试：app.test（透传+非法 URL/类型 400）、集成（四字段读回）、processing（上下文进模型/类型链接不进）。
- 验证：root typecheck/API 424/Web 81/build/对齐/契约 20 通过/diff --check 全绿；妙搭 type:check/路由 109/build:prod 全绿。
