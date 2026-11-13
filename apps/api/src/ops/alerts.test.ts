import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEventRecord, PipelineJobRecord } from "../domain/persistence.js";
import { OPS_ALERT_EVENT_FAILED, OPS_ALERT_EVENT_SENT, buildOpsAlertText, readOpsAlertConfig, runOpsAlert } from "./alerts.js";

const NOW = new Date("2026-11-10T08:00:00.000Z");

function job(overrides: Partial<PipelineJobRecord> = {}): PipelineJobRecord {
  return {
    id: "job-1", jobType: "base_push", dedupeKey: "base-push:req-1", payload: { requirementId: "req-1", actorId: "actor-1" },
    status: "failed", attemptCount: 5, maxAttempts: 5, availableAt: NOW.toISOString(), lockedUntil: null,
    lastErrorCode: "BASE_TIMEOUT", lastErrorSummary: "upstream timed out", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function harness(failed: PipelineJobRecord[], stuck: PipelineJobRecord[] = []) {
  const events: AuditEventRecord[] = [];
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const jobs = {
    listFailed: async () => failed,
    listExhaustedRunning: async () => stuck,
  } as never;
  const audit = {
    append: async (event: AuditEventRecord) => { events.push(event); },
    search: async (query: { entityId?: string; eventType?: string; since?: string }) => events.filter((event) =>
      (query.entityId === undefined || event.entityId === query.entityId)
      && (query.eventType === undefined || event.eventType === query.eventType)
      && (query.since === undefined || event.occurredAt >= query.since)),
  } as never;
  let reply: { status: number; body: unknown } | Error = { status: 200, body: { code: 0 } };
  const fetcher = (async (url: string, init: RequestInit) => {
    posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (reply instanceof Error) throw reply;
    return Response.json(reply.body, { status: reply.status });
  }) as unknown as typeof fetch;
  return { events, posts, jobs, audit, fetcher, setReply: (next: typeof reply) => { reply = next; } };
}

const config = { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test" };

test("alerts are disabled without an https webhook", async () => {
  assert.deepEqual(readOpsAlertConfig({}), { webhookUrl: undefined });
  assert.equal(readOpsAlertConfig({ RQSYS_ALERT_WEBHOOK_URL: "http://insecure/hook" }).webhookUrl, undefined);
  assert.equal(readOpsAlertConfig({ RQSYS_ALERT_WEBHOOK_URL: " https://ok/hook ", RQSYS_ALERT_COOLDOWN_MINUTES: "30" }).cooldownMs, 30 * 60 * 1000);
  const h = harness([job()]);
  const result = await runOpsAlert({ config: { webhookUrl: undefined }, jobs: h.jobs, audit: h.audit, now: NOW, fetcher: h.fetcher });
  assert.equal(result.outcome, "disabled");
  assert.equal(h.posts.length, 0);
});

test("a healthy queue sends nothing", async () => {
  const h = harness([], []);
  const result = await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: NOW, fetcher: h.fetcher });
  assert.equal(result.outcome, "healthy");
  assert.equal(h.posts.length, 0);
  assert.equal(h.events.length, 0);
});

test("sends one summary, audits it, and suppresses the same signature during cooldown", async () => {
  const h = harness([job(), job({ id: "job-2", jobType: "analysis", lastErrorCode: "rate_limited" })], [job({ id: "job-3", status: "running" })]);
  const first = await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: NOW, fetcher: h.fetcher });
  assert.equal(first.outcome, "sent");
  assert.equal(h.posts.length, 1);
  const text = String((h.posts[0]!.body.content as { text: string }).text);
  assert.match(text, /失败作业 2 条/);
  assert.match(text, /卡住的运行中作业 1 条/);
  // 不含 payload 中的需求/操作者信息
  assert.doesNotMatch(text, /req-1|actor-1|upstream timed out/);
  assert.equal(h.events[0]?.eventType, OPS_ALERT_EVENT_SENT);
  assert.deepEqual(h.events[0]?.safeDetails, { failed: 2, stuck: 1, httpStatus: 200 });

  const again = await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: new Date(NOW.getTime() + 60_000), fetcher: h.fetcher });
  assert.equal(again.outcome, "suppressed");
  assert.equal(h.posts.length, 1);

  const later = await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: new Date(NOW.getTime() + 7 * 60 * 60 * 1000), fetcher: h.fetcher });
  assert.equal(later.outcome, "sent");
  assert.equal(h.posts.length, 2);
});

test("a new failure changes the signature and alerts again inside the cooldown", async () => {
  const failed = [job()];
  const h = harness(failed);
  assert.equal((await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: NOW, fetcher: h.fetcher })).outcome, "sent");
  failed.unshift(job({ id: "job-new" }));
  assert.equal((await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: new Date(NOW.getTime() + 60_000), fetcher: h.fetcher })).outcome, "sent");
  assert.equal(h.posts.length, 2);
});

test("webhook rejection or network errors are audited as failed and retried next tick", async () => {
  const h = harness([job()]);
  h.setReply({ status: 200, body: { code: 19024, msg: "Key Words Not Found" } });
  assert.equal((await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: NOW, fetcher: h.fetcher })).outcome, "failed");
  assert.equal(h.events[0]?.eventType, OPS_ALERT_EVENT_FAILED);
  h.setReply(new Error("ECONNRESET"));
  assert.equal((await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: new Date(NOW.getTime() + 60_000), fetcher: h.fetcher })).outcome, "failed");
  // 失败不进入冷却：恢复后下一轮立即发送
  h.setReply({ status: 200, body: { code: 0 } });
  assert.equal((await runOpsAlert({ config, jobs: h.jobs, audit: h.audit, now: new Date(NOW.getTime() + 120_000), fetcher: h.fetcher })).outcome, "sent");
});

test("alert text marks a truncated failed list", () => {
  const many = Array.from({ length: 50 }, (_, index) => job({ id: `job-${index}` }));
  assert.match(buildOpsAlertText(many, [], NOW), /失败作业 50\+ 条/);
});
