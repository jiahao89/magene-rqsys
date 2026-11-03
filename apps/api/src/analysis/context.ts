// 模型上下文组装：root 与妙搭共用同一实现，避免组合根各自拼装导致行为漂移。
// 只包含已批准的来源字段；TB 无字段映射时为空字符串，模型只看到标题。
// V02-T05：手工需求批准的产品/型号与边界/限制进入上下文；
// 需求类型是人工录入值（与 AI 建议分开）、来源链接可能带敏感参数——二者不发送模型。
// V02-T26：人工补充上下文以独立段追加，明确标注“补充上下文”，不伪装成来源事实。
export interface AnalysisContextSource {
  scope: string | null;
  acceptanceCriteria: string | null;
  productModel?: string | null;
  constraintNotes?: string | null;
  /** V02-T26：人工补充上下文文本（调用方可显式传入）。 */
  analysisContextNote?: string | null;
  /** 兼容 RequirementRecord 直接传入：读取 requirement.analysisContext.note。 */
  analysisContext?: { note?: string | null } | null;
}

export function analysisModelContext(requirement: AnalysisContextSource): string {
  const supplement = requirement.analysisContextNote ?? requirement.analysisContext?.note ?? null;
  return [requirement.scope, requirement.acceptanceCriteria, requirement.productModel, requirement.constraintNotes]
    .filter((value): value is string => Boolean(value))
    .concat(supplement ? [`补充上下文：${supplement}`] : [])
    .join("\n\n");
}
