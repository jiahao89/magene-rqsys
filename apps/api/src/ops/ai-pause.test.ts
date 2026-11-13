import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEventRecord } from "../domain/persistence.js";
import {
  AI_PAUSE_FLAG, noteAiQuotaFailure, readAiPause, readAiPauseConfig,
} from "./ai-pause.js";

const NOW = new Date("2026-11-12T08:00:00.000Z");

function harness(initial: Record<string, unknown> | null = null, failures = 0) {
  let stored = initial;
  const events: AuditEventRecord[] = [];
  const alerts: Array<{ text: string }> = [];
  const flags = {
    async get(name: string) { return name === AI_PAUSE_FLAG && stored ? { value: stored, updatedAt: NOW.toISOString() } : null; },
    async set(_name: string, value: Record<string, unknown>) { stored = value; },
  };
  const audit = {
    async append(event: AuditEventRecord) { events.push(event); },
    async search() { return []; },
  };
  const analyses = { countRecentFailures: async () => failures };
  const fetcher = (async (_url: string, init: RequestInit) => {
    alerts.push({ text: (JSON.parse(String(init.body)) as { content: { text: string } }).content.text });
    return Response.json({ code: 0 });
  }) as unknown as typeof fetch;
  return { flags, audit, analyses, events, alerts, fetcher, stored: () => stored };
}

test("reads the pause flag and treats an expired until as recovered", async () => {
  assert.deepEqual(await readAiPause(undefined, NOW), { paused: false, until: null, reason: null });
  const future = harness({ until: "2026-11-12T09:00:00.000Z", reason: "ai_rate_limited" });
  assert.equal((await readAiPause(future.flags as never, NOW)).paused, true);
  const past = harness({ until: "2026-11-12T07:00:00.000Z", reason: "ai_rate_limited" });
  assert.equal((await readAiPause(past.flags as never, NOW)).paused, false);
});

test("pauses only after the threshold and alerts once", async () => {
  const below = harness(null, 2);
  const notYet = await noteAiQuotaFailure({ analyses: below.analyses as never, flags: below.flags as never, audit: below.audit as never, alerts: { config: { webhookUrl: "https://hook" }, fetcher: below.fetcher }, now: NOW });
  assert.equal(notYet.paused, false);
  assert.equal(below.stored(), null);

  const reached = harness(null, 3);
  const paused = await noteAiQuotaFailure({ analyses: reached.analyses as never, flags: reached.flags as never, audit: reached.audit as never, alerts: { config: { webhookUrl: "https://hook" }, fetcher: reached.fetcher }, now: NOW });
  assert.equal(paused.paused, true);
  assert.equal(paused.newlyPaused, true);
  assert.equal(paused.until, "2026-11-12T08:30:00.000Z");
  assert.equal((reached.stored() as Record<string, unknown>)["reason"], "ai_rate_limited");
  assert.equal(reached.events.filter((event) => event.eventType === "ops.ai_analysis_paused").length, 1);
  assert.equal(reached.events.some((event) => event.eventType === "ops.alert_sent"), true);
  assert.equal(reached.alerts.length, 1);
  assert.match(reached.alerts[0]!.text, /已暂停自动分析入队至/);

  // 已暂停时重复失败不重复写 flag/告警
  const again = await noteAiQuotaFailure({ analyses: reached.analyses as never, flags: reached.flags as never, audit: reached.audit as never, alerts: { config: { webhookUrl: "https://hook" }, fetcher: reached.fetcher }, now: new Date(NOW.getTime() + 60_000) });
  assert.equal(again.paused, true);
  assert.equal(again.newlyPaused, false);
  assert.equal(reached.events.filter((event) => event.eventType === "ops.ai_analysis_paused").length, 1);
  assert.equal(reached.alerts.length, 1);
});

test("works without an alert channel and ignores missing repositories", async () => {
  const reached = harness(null, 3);
  const paused = await noteAiQuotaFailure({ analyses: reached.analyses as never, flags: reached.flags as never, audit: reached.audit as never, now: NOW });
  assert.equal(paused.paused, true);
  assert.equal(reached.alerts.length, 0);
  assert.deepEqual(await noteAiQuotaFailure({ analyses: undefined, flags: undefined, audit: reached.audit as never, now: NOW }), { paused: false, newlyPaused: false, failures: 0, until: null });
});

test("parses the pause configuration with safe defaults", () => {
  assert.deepEqual(readAiPauseConfig({}), { threshold: 3, windowMinutes: 10, pauseMinutes: 30 });
  assert.deepEqual(readAiPauseConfig({ RQSYS_AI_PAUSE_THRESHOLD: "5", RQSYS_AI_PAUSE_WINDOW_MINUTES: "15", RQSYS_AI_PAUSE_MINUTES: "60" }), { threshold: 5, windowMinutes: 15, pauseMinutes: 60 });
  assert.deepEqual(readAiPauseConfig({ RQSYS_AI_PAUSE_THRESHOLD: "0", RQSYS_AI_PAUSE_MINUTES: "abc" }), { threshold: 3, windowMinutes: 10, pauseMinutes: 30 });
});
