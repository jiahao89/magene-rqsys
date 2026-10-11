export function basePushIdempotencyKey(requirementId: string, sourceVersion: number, analysisVersion: number, intentId?: string): string {
  return `base-push:${requirementId}:sv${sourceVersion}:av${analysisVersion}${intentId ? `:${intentId}` : ""}`;
}
