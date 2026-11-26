// 2026-11-26：需求评估按需生成限流（进程内滑动窗口，与 prd-prompt/rate-limit.ts 同口径）。
// 默认 3 次/分钟、30 次/天；超限返回 429 + Retry-After，不创建版本、不调模型。
export interface AssessmentRateLimit {
  perMinute: number;
  perDay: number;
}

export const DEFAULT_ASSESSMENT_RATE_LIMIT: AssessmentRateLimit = { perMinute: 3, perDay: 30 };

export const ASSESSMENT_RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export interface AssessmentRateLimitResult { ok: boolean; retryAfterSeconds?: number }

export function createAssessmentRateLimiter(
  limit: AssessmentRateLimit = DEFAULT_ASSESSMENT_RATE_LIMIT,
  now: () => number = Date.now,
) {
  const recent = new Map<string, number[]>();
  const DAY_MS = 24 * 60 * 60 * 1000;
  return {
    check(key: string, atMs?: number): AssessmentRateLimitResult {
      const at = atMs ?? now();
      const kept = (recent.get(key) ?? []).filter((stamp) => at - stamp < DAY_MS);
      const lastMinute = kept.filter((stamp) => at - stamp < 60_000);
      if (lastMinute.length >= limit.perMinute) {
        const waitMs = 60_000 - (at - lastMinute[0]!);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
      if (kept.length >= limit.perDay) {
        return { ok: false, retryAfterSeconds: ASSESSMENT_RATE_LIMIT_RETRY_AFTER_SECONDS };
      }
      recent.set(key, [...kept, at]);
      return { ok: true };
    },
  };
}
