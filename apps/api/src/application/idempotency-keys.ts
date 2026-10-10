export function basePushIdempotencyKey(requirementId: string, sourceVersion: number, analysisVersion: number): string {
  return `base-push:${requirementId}:sv${sourceVersion}:av${analysisVersion}`;
}
