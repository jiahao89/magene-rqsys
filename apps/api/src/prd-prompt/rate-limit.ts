// 2026-11-21：PRD 提示词生成限流（进程内，与聊天草稿同口径的滑动窗口实现）。
// 规格 §4：2 次/分钟、20 次/天；超限返回 429 + Retry-After，不创建版本、不调模型。
export interface PrdPromptRateLimit {
  perMinute: number;
  perDay: number;
}

export const DEFAULT_PRD_PROMPT_RATE_LIMIT: PrdPromptRateLimit = { perMinute: 2, perDay: 20 };

export const PRD_PROMPT_RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export interface PrdPromptRateLimitResult { ok: boolean; retryAfterSeconds?: number }

export function createPrdPromptRateLimiter(limit: PrdPromptRateLimit = DEFAULT_PRD_PROMPT_RATE_LIMIT, now: () => number = Date.now) {
  const recent = new Map<string, number[]>();
  const DAY_MS = 24 * 60 * 60 * 1000;
  return {
    check(key: string): PrdPromptRateLimitResult {
      const at = now();
      const kept = (recent.get(key) ?? []).filter((stamp) => at - stamp < DAY_MS);
      const lastMinute = kept.filter((stamp) => at - stamp < 60_000);
      if (lastMinute.length >= limit.perMinute) {
        const waitMs = 60_000 - (at - lastMinute[0]!);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
      if (kept.length >= limit.perDay) return { ok: false, retryAfterSeconds: PRD_PROMPT_RATE_LIMIT_RETRY_AFTER_SECONDS };
      recent.set(key, [...kept, at]);
      return { ok: true };
    },
  };
}
