// 模型上下文组装：root 与妙搭共用同一实现，避免组合根各自拼装导致行为漂移。
// 只包含已批准的来源字段；TB 无字段映射时为空字符串，模型只看到标题。
export interface AnalysisContextSource {
  scope: string | null;
  acceptanceCriteria: string | null;
}

export function analysisModelContext(requirement: AnalysisContextSource): string {
  return [requirement.scope, requirement.acceptanceCriteria]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}
