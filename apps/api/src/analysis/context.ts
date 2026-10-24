// 模型上下文组装：root 与妙搭共用同一实现，避免组合根各自拼装导致行为漂移。
// 只包含已批准的来源字段；TB 无字段映射时为空字符串，模型只看到标题。
// V02-T05：手工需求批准的产品/型号与边界/限制进入上下文；
// 需求类型是人工录入值（与 AI 建议分开）、来源链接可能带敏感参数——二者不发送模型。
export interface AnalysisContextSource {
  scope: string | null;
  acceptanceCriteria: string | null;
  productModel?: string | null;
  constraintNotes?: string | null;
}

export function analysisModelContext(requirement: AnalysisContextSource): string {
  return [requirement.scope, requirement.acceptanceCriteria, requirement.productModel, requirement.constraintNotes]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}
