const labels: Record<string, string> = {
  pending: "等待中",
  running: "进行中",
  synced: "已同步",
  analyzed: "已分析",
  pushed: "已推送",
  failed: "失败",
  failed_retryable: "待重试",
  partial_failure: "部分失败",
  succeeded: "已完成",
  pending_mapping: "待匹配",
  auto_mapped: "已匹配",
  manually_mapped: "手动匹配",
  not_required: "无需匹配",
};

export function stateLabel(state: string): string {
  return labels[state] ?? state;
}
