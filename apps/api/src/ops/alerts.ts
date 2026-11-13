// 运维告警：把失败作业与卡住的运行中作业摘要推送到飞书群机器人。
//
// 只读汇总 + 外发一条文本消息，不改任何作业状态；修复仍由各自的恢复器或人工重试完成。
// 去重：按「失败数 + 卡住数 + 最新失败作业」生成签名，同签名在冷却期内只发一次，
// 签名与发送结果写入审计（ops.alert_sent / ops.alert_failed），重启后仍能去重。
// 内容只含作业类型、计数与错误码，不含需求标题、负责人或 payload。

import { createHash, randomUUID } from "node:crypto";
import type { AuditEventRepository, PipelineJobRepository } from "../application/repositories.js";
import type { PipelineJobRecord } from "../domain/persistence.js";

export const OPS_ALERT_EVENT_SENT = "ops.alert_sent";
export const OPS_ALERT_EVENT_FAILED = "ops.alert_failed";
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const LIST_LIMIT = 50;

export interface OpsAlertConfig {
  /** 飞书自定义机器人 webhook；未配置时整个告警关闭。 */
  webhookUrl: string | undefined;
  /** 同签名的最短重发间隔。 */
  cooldownMs?: number;
}

export interface OpsAlertResult {
  outcome: "disabled" | "healthy" | "suppressed" | "sent" | "failed";
  failed: number;
  stuck: number;
  signature?: string;
}

export function readOpsAlertConfig(env: Record<string, string | undefined>): OpsAlertConfig {
  const webhookUrl = env.RQSYS_ALERT_WEBHOOK_URL?.trim();
  const cooldownMinutes = Number(env.RQSYS_ALERT_COOLDOWN_MINUTES ?? "");
  return {
    // 只接受 https：webhook 地址本身即凭据，明文传输会泄漏。
    webhookUrl: webhookUrl && webhookUrl.startsWith("https://") ? webhookUrl : undefined,
    ...(Number.isFinite(cooldownMinutes) && cooldownMinutes > 0 ? { cooldownMs: cooldownMinutes * 60 * 1000 } : {}),
  };
}

function countByType(jobs: PipelineJobRecord[]): string {
  const counts = new Map<string, number>();
  for (const job of jobs) counts.set(job.jobType, (counts.get(job.jobType) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, n]) => `${type}×${n}`).join("、");
}

function topErrorCodes(jobs: PipelineJobRecord[]): string {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const code = job.lastErrorCode ?? "unknown";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([code, n]) => `${code}×${n}`).join("、");
}

export function buildOpsAlertSignature(failed: PipelineJobRecord[], stuck: PipelineJobRecord[]): string {
  // 最新失败作业 id 进入签名：同样数量但出现了新失败时也会重新提醒。
  const latestFailed = failed[0]?.id ?? "";
  const stuckIds = stuck.map((job) => job.id).sort().join(",");
  return createHash("sha256").update(`${failed.length}|${stuck.length}|${latestFailed}|${stuckIds}`).digest("hex").slice(0, 16);
}

export function buildOpsAlertText(failed: PipelineJobRecord[], stuck: PipelineJobRecord[], now: Date): string {
  const lines = [`【RQ-Sys 运维提醒】${now.toISOString()}`];
  if (failed.length > 0) lines.push(`失败作业 ${failed.length}${failed.length >= LIST_LIMIT ? "+" : ""} 条：${countByType(failed)}；主要错误码：${topErrorCodes(failed)}`);
  if (stuck.length > 0) lines.push(`卡住的运行中作业 ${stuck.length} 条：${countByType(stuck)}`);
  lines.push("请在工作台「作业运维」页查看明细，并按 runbook 重试或回收。");
  return lines.join("\n");
}

/**
 * 发送一条运维文本告警：同签名在冷却期内只发一次，成功/失败都写审计。
 * 供失败作业摘要与 AI 额度暂停共用；返回值与 runOpsAlert 的 outcome 对齐。
 */
export async function sendOpsAlertText(params: {
  config: OpsAlertConfig;
  audit: AuditEventRepository;
  now: Date;
  signature: string;
  text: string;
  safeDetails?: Record<string, unknown>;
  fetcher?: typeof fetch;
}): Promise<"sent" | "failed" | "suppressed"> {
  const { config, audit, now } = params;
  if (!config.webhookUrl) return "suppressed";
  const cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const recent = await audit.search({
    entityId: params.signature,
    eventType: OPS_ALERT_EVENT_SENT,
    since: new Date(now.getTime() - cooldownMs).toISOString(),
    limit: 1,
  });
  if (recent.length > 0) return "suppressed";

  const fetcher = params.fetcher ?? fetch;
  let ok = false;
  let httpStatus: number | null = null;
  try {
    const response = await fetcher(config.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg_type: "text", content: { text: params.text } }),
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = response.status;
    const body = await response.json().catch(() => null) as { code?: number; StatusCode?: number } | null;
    const code = body?.code ?? body?.StatusCode ?? 0;
    ok = response.ok && code === 0;
  } catch {
    ok = false;
  }
  await audit.append({
    id: randomUUID(), actorId: null, eventType: ok ? OPS_ALERT_EVENT_SENT : OPS_ALERT_EVENT_FAILED,
    entityType: "ops_alert", entityId: params.signature, result: ok ? "succeeded" : "failed",
    safeDetails: { ...(params.safeDetails ?? {}), ...(httpStatus === null ? {} : { httpStatus }) },
    occurredAt: now.toISOString(),
  });
  return ok ? "sent" : "failed";
}

export async function runOpsAlert(params: {
  config: OpsAlertConfig;
  jobs: PipelineJobRepository;
  audit: AuditEventRepository;
  now: Date;
  fetcher?: typeof fetch;
}): Promise<OpsAlertResult> {
  const { config, jobs, audit, now } = params;
  if (!config.webhookUrl || !jobs.listFailed || !jobs.listExhaustedRunning) return { outcome: "disabled", failed: 0, stuck: 0 };
  const [failed, stuck] = await Promise.all([
    jobs.listFailed(LIST_LIMIT),
    jobs.listExhaustedRunning(now.toISOString(), LIST_LIMIT),
  ]);
  if (failed.length === 0 && stuck.length === 0) return { outcome: "healthy", failed: 0, stuck: 0 };

  const signature = buildOpsAlertSignature(failed, stuck);
  const outcome = await sendOpsAlertText({
    config, audit, now, signature, text: buildOpsAlertText(failed, stuck, now),
    safeDetails: { failed: failed.length, stuck: stuck.length },
    ...(params.fetcher ? { fetcher: params.fetcher } : {}),
  });
  return { outcome, failed: failed.length, stuck: stuck.length, signature };
}
