// I3-3：AI 额度耗尽保护。
//
// 背景：供应商 429/额度耗尽时，自动重试和补排会在短时间内制造大量失败分析。
// 策略（最小闭环、可自动恢复）：
//   1. 分析以 rate_limited 失败后计数；窗口内达到阈值 → 写入 system_flags 暂停标记，
//      自动分析入队（首分析补排/自动重试）跳过；手动重试仍允许，便于恢复验证。
//   2. 暂停带 until；到期后 readAiPause 自动视为恢复，现有恢复器会补跑 pending 与可重试需求。
//   3. 新暂停时发一条飞书告警（与失败作业告警共用 webhook / 冷却 / 审计）。

import { randomUUID } from "node:crypto";
import type { AnalysisRunRepository, AuditEventRepository, SystemFlagRepository } from "../application/repositories.js";
import type { OpsAlertConfig } from "./alerts.js";
import { sendOpsAlertText } from "./alerts.js";

export const AI_PAUSE_FLAG = "ai_analysis_pause";
export const DEFAULT_AI_PAUSE_THRESHOLD = 3;
export const DEFAULT_AI_PAUSE_WINDOW_MINUTES = 10;
export const DEFAULT_AI_PAUSE_MINUTES = 30;

/** 组合根读取环境变量；非法/缺省回落到默认阈值。 */
export function readAiPauseConfig(env: Record<string, string | undefined>): { threshold: number; windowMinutes: number; pauseMinutes: number } {
  const num = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value ?? "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    threshold: num(env.RQSYS_AI_PAUSE_THRESHOLD, DEFAULT_AI_PAUSE_THRESHOLD),
    windowMinutes: num(env.RQSYS_AI_PAUSE_WINDOW_MINUTES, DEFAULT_AI_PAUSE_WINDOW_MINUTES),
    pauseMinutes: num(env.RQSYS_AI_PAUSE_MINUTES, DEFAULT_AI_PAUSE_MINUTES),
  };
}

export interface AiPauseState {
  paused: boolean;
  until: string | null;
  reason: string | null;
}

export async function readAiPause(flags: SystemFlagRepository | undefined, now: Date): Promise<AiPauseState> {
  if (!flags) return { paused: false, until: null, reason: null };
  let row: Awaited<ReturnType<SystemFlagRepository["get"]>> = null;
  try {
    row = await flags.get(AI_PAUSE_FLAG);
  } catch {
    // 开关读取失败时不阻断分析：宁可多跑一次，也不要因存储抖动把整条链路停死。
    return { paused: false, until: null, reason: null };
  }
  if (!row) return { paused: false, until: null, reason: null };
  const until = typeof row.value.until === "string" ? row.value.until : null;
  const reason = typeof row.value.reason === "string" ? row.value.reason : null;
  return { paused: until !== null && new Date(until).getTime() > now.getTime(), until, reason };
}

export async function noteAiQuotaFailure(params: {
  analyses: Pick<AnalysisRunRepository, "countRecentFailures"> | undefined;
  flags: SystemFlagRepository | undefined;
  audit: AuditEventRepository;
  alerts?: { config: OpsAlertConfig; fetcher?: typeof fetch } | undefined;
  now: Date;
  threshold?: number;
  windowMinutes?: number;
  pauseMinutes?: number;
}): Promise<{ paused: boolean; newlyPaused: boolean; failures: number; until: string | null }> {
  const { analyses, flags, audit, now } = params;
  if (!flags || !analyses?.countRecentFailures) return { paused: false, newlyPaused: false, failures: 0, until: null };

  const existing = await readAiPause(flags, now);
  if (existing.paused) return { paused: true, newlyPaused: false, failures: 0, until: existing.until };

  const threshold = params.threshold ?? DEFAULT_AI_PAUSE_THRESHOLD;
  const windowMinutes = params.windowMinutes ?? DEFAULT_AI_PAUSE_WINDOW_MINUTES;
  const pauseMinutes = params.pauseMinutes ?? DEFAULT_AI_PAUSE_MINUTES;
  const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();

  let failures: number;
  try {
    failures = await analyses.countRecentFailures("rate_limited", since);
  } catch {
    return { paused: false, newlyPaused: false, failures: 0, until: null };
  }
  if (failures < threshold) return { paused: false, newlyPaused: false, failures, until: null };

  const until = new Date(now.getTime() + pauseMinutes * 60_000).toISOString();
  await flags.set(AI_PAUSE_FLAG, { until, reason: "ai_rate_limited", failures, windowMinutes }, now.toISOString());
  await audit.append({
    id: randomUUID(), actorId: null, eventType: "ops.ai_analysis_paused",
    entityType: "system_flag", entityId: AI_PAUSE_FLAG, result: "succeeded",
    safeDetails: { reason: "ai_rate_limited", failed: failures }, occurredAt: now.toISOString(),
  });

  if (params.alerts) {
    try {
      await sendOpsAlertText({
        config: params.alerts.config, audit, now,
        signature: `ai-pause:${until.slice(0, 16)}`,
        text: `【RQ-Sys】AI 额度可能耗尽：最近 ${windowMinutes} 分钟 ${failures} 次限流失败，已暂停自动分析入队至 ${until}。手动重试仍可用；到期后自动补跑。`,
        safeDetails: { failed: failures },
        ...(params.alerts.fetcher ? { fetcher: params.alerts.fetcher } : {}),
      });
    } catch {
      // 告警失败不影响暂停本身（暂停已落库）。
    }
  }
  return { paused: true, newlyPaused: true, failures, until };
}
