// RQ-Sys V0.2 本地端到端功能验证（真实 PostgreSQL + 真实 HTTP handler + 真实 worker + 受控 AI/Base）。
// 运行：node --import tsx .scratch/rq-sys-v0.2/verification-20261026/e2e/harness.mts
import { randomUUID } from "node:crypto";
import { createHarness, check, equal, failures, observe, VERIFY_ACTOR, PM_LEADER_USER_ID, BASE_FIELDS } from "./fixtures.mts";
import { handleApiRequest } from "../../../../apps/api/src/http/app.js";
import { recheckOwnerMappings } from "../../../../apps/api/src/scheduler/owner-recheck.js";

const connectionString = process.env.VERIFY_DATABASE_URL
  ?? `postgresql://postgres@/rq_verify_20261026?host=${process.env.HOME}/.local/share/rq-sys/postgres`;
const h = await createHarness(connectionString);
await h.resetBusinessData();

async function q<T = any>(sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await h.pool.query(sql, values);
  return result.rows as T[];
}
async function one<T = any>(sql: string, values: unknown[] = []): Promise<T | null> {
  return (await q<T>(sql, values))[0] ?? null;
}
function section(name: string) { process.stdout.write(`\n=== ${name} ===\n`); }

// 强制绕过 handler 异常，让非法输入路径的 500 也能被记录（生产 server 会兜底成 INTERNAL）。
const rawApi = h.api;
async function safeApi(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  try { return await rawApi(method, path, body, headers); }
  catch (error) { return { status: 500, body: { thrown: (error as Error).name }, text: String(error) }; }
}

try {
  // ---------------------------------------------------------------- 健康与 fail-closed
  section("S0 健康检查 / 身份 fail-closed");
  {
    const health = await h.api("GET", "/api/health");
    equal("health 200 + ok", health.status, 200);
    const ready = await h.api("GET", "/api/health/ready");
    equal("ready 200 + database connected", ready.body, { status: "ready", database: "connected" });
    const noIdentity = await handleApiRequest(
      new Request("http://verify.local/api/requirements"),
      { ...h.deps, identity: undefined },
    );
    equal("无身份访问受保护路由 → 401", noIdentity.status, 401);
    const metrics = await h.api("GET", "/api/overview/metrics");
    equal("初始指标全 0", metrics.body.counts, {
      total: 0, pullSynced: 0, analysisAnalyzed: 0, ownerResolved: 0, pushPushed: 0, failed: 0, pushFailed: 0, pushPending: 0,
    });
  }

  // ---------------------------------------------------------------- 手工收录
  section("S1 手工新建（V02-T04/T05/T06）");
  const intakePayload = {
    title: "导航在复杂路口偏航后重规划不稳定",
    description: "用户：通勤骑行者。场景：城市复杂路口。现状问题：偏航后提示慢。期望结果：快速重规划。反馈人：张三，电话 13800138000，邮箱 rider@example.com。",
    sourceChannel: "终端用户",
    productModel: "C606",
    requirementType: "体验优化",
    constraintNotes: "需兼容旧款码表屏幕",
    supplementUrl: "https://example.com/feedback/123",
    intakeModule: "爬坡",
    owner: { feishuUserId: "ou_manual_owner_a", feishuIdType: "open_id", tbDisplayName: "手册负责人A" },
  };
  const intakeKey = "verify-intake-key-0001";
  let manualId = "";
  {
    const created = await h.api("POST", "/api/requirements", intakePayload, { "Idempotency-Key": intakeKey });
    equal("新建返回 201", created.status, 201);
    equal("平台编号 RQ-000001", created.body.platformRequirementId, "RQ-000001");
    equal("来源类型 web_manual", created.body.sourceType, "web_manual");
    equal("收录状态 collected", created.body.status, "collected");
    manualId = created.body.requirementId;

    const replay = await h.api("POST", "/api/requirements", intakePayload, { "Idempotency-Key": intakeKey });
    equal("同键同内容重放 200", replay.status, 200);
    equal("重放复用同一需求 ID", replay.body.requirementId, manualId);
    equal("重放复用同一平台编号", replay.body.platformRequirementId, "RQ-000001");
    equal("重放不新增需求", (await one<{ n: string }>("select count(*) n from requirements"))?.n, "1");

    const conflict = await h.api("POST", "/api/requirements", { ...intakePayload, title: "另一个标题" }, { "Idempotency-Key": intakeKey });
    equal("同键不同内容 409", conflict.status, 409);
    const noKey = await h.api("POST", "/api/requirements", intakePayload);
    equal("缺幂等键 400", noKey.status, 400);
    const noDescription = await h.api("POST", "/api/requirements", { title: "x", sourceChannel: "终端用户" }, { "Idempotency-Key": "verify-intake-key-0002" });
    equal("缺描述 400", noDescription.status, 400);
    const badChannel = await h.api("POST", "/api/requirements", { ...intakePayload, sourceChannel: "未知渠道" }, { "Idempotency-Key": "verify-intake-key-0003" });
    equal("未知渠道 400", badChannel.status, 400);
    const badModule = await h.api("POST", "/api/requirements", { ...intakePayload, intakeModule: "不存在的模块" }, { "Idempotency-Key": "verify-intake-key-0004" });
    equal("未发布词典模块 400", badModule.status, 400);

    const row = await one("select * from requirements where id=$1", [manualId]);
    equal("DB source_type=web_manual", row?.source_type, "web_manual");
    equal("DB 无 source_config_id", row?.source_config_id, null);
    equal("DB 无假 TB ID", row?.teambition_requirement_id, null);
    equal("DB pull_state=collected", row?.pull_state, "collected");
    equal("DB analysis_state=pending", row?.analysis_state, "pending");
    equal("DB owner_state=manually_mapped", row?.owner_state, "manually_mapped");
    equal("DB 录入模块", row?.intake_module, "爬坡");
    equal("DB 产品型号", row?.product_model, "C606");
    equal("DB 需求类型", row?.requirement_type, "体验优化");
    equal("DB 边界", row?.constraint_notes, "需兼容旧款码表屏幕");
    equal("DB 补充链接", row?.supplement_url, "https://example.com/feedback/123");
    equal("录入人=可信 actor", row?.manual_owner_assigned_by, VERIFY_ACTOR);
    equal("来源快照 v1", (await one<{ n: string }>("select count(*) n from source_snapshots where requirement_id=$1 and source_version=1", [manualId]))?.n, "1");
    equal("收录审计 1 条", (await one<{ n: string }>("select count(*) n from audit_events where event_type='intake.created' and entity_id=$1", [manualId]))?.n, "1");
    equal("幂等回执 1 条", (await one<{ n: string }>("select count(*) n from requirement_intake_receipts"))?.n, "1");
    equal("手工负责人不污染 TB 人员映射", (await one<{ n: string }>("select count(*) n from person_mappings"))?.n, "0");
    equal("分析作业已入队", (await one<{ n: string }>("select count(*) n from pipeline_jobs where job_type='analysis' and payload->>'requirementId'=$1", [manualId]))?.n, "1");

    const emptySearch = await h.api("GET", "/api/requirements?q=verify-no-such-requirement-zzz");
    equal("空搜索结果 200（F-01 回归）", emptySearch.status, 200);
    equal("空搜索结果为空数组", emptySearch.body.items, []);

    const list = await h.api("GET", "/api/requirements?limit=25");
    equal("列表包含手工来源", list.body.items[0]?.sourceType, "web_manual");
    equal("手工详情无 TB 地址", list.body.items[0]?.sourceUrl, null);

    const detail = await h.api("GET", `/api/requirements/${manualId}`);
    equal("详情 sourceType", detail.body.sourceType, "web_manual");
    equal("详情 sourceRequirementId 为空", detail.body.sourceRequirementId, null);
    equal("详情 sourceUrl 为空", detail.body.sourceUrl, null);
    equal("详情 audience 未确认空集", detail.body.audience, { tags: [], confirmed: false, version: 0 });
    equal("详情 manualOwner 版本 1", detail.body.manualOwner?.assignmentVersion, 1);
    equal("详情无 repeated 伪批次", detail.body.source?.sourceType, "web_manual");
    equal("详情分析尚未产生", detail.body.analysis, null);
    const metrics = await h.api("GET", "/api/overview/metrics");
    equal("指标 total=1 / pullSynced=0（手工不伪装 TB）", [metrics.body.counts.total, metrics.body.counts.pullSynced], [1, 0]);
  }

  // ---------------------------------------------------------------- 主 AI + Base 首推
  section("S2 主 AI + Base 首推（V02-T08/T10/T03/T06）");
  let manualBaseRecordId = "";
  {
    const results = await h.drain();
    check("worker 处理分析 + 推送作业", results.some((r) => r.kind === "succeeded"), results);
    check("worker 最终 idle", results.at(-1)?.kind === "idle", results);
    equal("分析 provider 只调用 1 次", h.analysisProvider.calls.length, 1);
    const masked = h.analysisProvider.calls[0]!.masked;
    check("PII：手机号未进模型", !JSON.stringify(masked).includes("13800138000"), masked);
    check("PII：邮箱未进模型", !JSON.stringify(masked).includes("rider@example.com"), masked);
    check("PII：带标签姓名已掩码", masked.description.includes("姓名已掩码") || !masked.description.includes("张三"), masked.description);

    const row = await one("select * from requirements where id=$1", [manualId]);
    equal("分析状态 analyzed", row?.analysis_state, "analyzed");
    equal("推送状态 pushed", row?.push_state, "pushed");
    check("Base recordId 已记账", Boolean(row?.base_record_id), row?.base_record_id);
    manualBaseRecordId = String(row?.base_record_id ?? "");
    const run = await one("select * from analysis_runs where requirement_id=$1 order by analysis_version desc", [manualId]);
    equal("分析版本 v1", Number(run?.analysis_version), 1);
    equal("规则 v1 确定性产出 P2（高+中+低+无法判断=1.5）", run?.priority, "P2");
    equal("模块建议=爬坡", run?.module_suggestion, "爬坡");
    const structured = typeof run?.structured_result === "string" ? JSON.parse(run.structured_result) : run?.structured_result ?? {};
    equal("结构化结果含类型建议", structured.typeSuggestion, "体验优化");
    equal("结构化结果含 2 条六层人群建议", structured.audience?.length, 2);
    equal("分析保留整体置信度单值", structured.confidence, "中");

    const baseRow = h.base.rows.get(manualBaseRecordId);
    check("Base 行存在", Boolean(baseRow));
    const f = baseRow?.fields ?? {};
    equal("Base 平台键=RQ-000001", f["需求平台ID"], "RQ-000001");
    check("手工行不写 TB需求ID", !("TB需求ID" in f), Object.keys(f));
    equal("Base 标题", f["标题"], intakePayload.title);
    equal("Base 执行人=人工负责人 A", f["执行人"], [{ id: "ou_manual_owner_a" }]);
    equal("Base AI优先级建议=P2", f["AI优先级建议"], "P2");
    equal("Base AI分析版本=1", f["AI分析版本"], "1");
    equal("Base 源版本=1", f["源版本"], "1");
    equal("Base 推送状态=已推送", f["推送状态"], "已推送");
    equal("Base PM状态=待处理", f["PM状态"], "待处理");
    equal("首推人工分配通知被分配人 A", f["系统通知收件人"], [{ id: "ou_manual_owner_a" }]);
    equal("通知类型=已分配负责人", f["系统通知类型"], "已分配负责人");
    check("通知事件ID 幂等且含 A", String(f["系统通知事件ID"]).startsWith("owner_assigned:"), f["系统通知事件ID"]);
    check("需求深链写入 Base", String(f["系统需求链接"]).includes(`requirement=${manualId}`), f["系统需求链接"]);
    equal("人员映射表仍为空", (await one<{ n: string }>("select count(*) n from person_mappings"))?.n, "0");
    equal("Base 推送运行记录 1 条", (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n, "1");
  }

  // ---------------------------------------------------------------- 改派
  section("S3 需求级改派（V02-T06）");
  {
    const before = await one<{ v: number }>("select manual_owner_assignment_version v from requirements where id=$1", [manualId]);
    const assigned = await h.api("PUT", `/api/requirements/${manualId}/owner`, {
      feishuUserId: "ou_manual_owner_b", feishuIdType: "open_id", tbDisplayName: "手册负责人B",
    });
    equal("改派 200", assigned.status, 200);
    equal("改派后状态 manually_mapped", assigned.body.ownerState, "manually_mapped");
    const after = await one<{ v: number; id: string }>("select manual_owner_assignment_version v, manual_owner_feishu_user_id id from requirements where id=$1", [manualId]);
    equal("分配版本递增到 2", Number(after?.v), Number(before?.v) + 1);
    equal("负责人更新为 B", after?.id, "ou_manual_owner_b");
    await h.drain();
    const baseRow = h.base.rows.get(manualBaseRecordId);
    const f = baseRow?.fields ?? {};
    equal("Base 执行人改为 B", f["执行人"], [{ id: "ou_manual_owner_b" }]);
    equal("改派通知收件人 B", f["系统通知收件人"], [{ id: "ou_manual_owner_b" }]);
    equal("改派通知类型=负责人变更", f["系统通知类型"], "负责人变更");
    equal("改派不新增 TB 人员映射", (await one<{ n: string }>("select count(*) n from person_mappings"))?.n, "0");
    equal("只有一条需求被改派", (await one<{ n: string }>("select count(*) n from requirements where manual_owner_feishu_user_id='ou_manual_owner_b'"))?.n, "1");
  }

  // ---------------------------------------------------------------- 编辑
  section("S4 手工编辑 / 版本 / PM 快照（V02-T07）");
  let versionAfterEdit = 0;
  {
    h.base.setPm(manualBaseRecordId, {
      "PM状态": "已采纳", "PM确认模块": "方案设计", "PM确认优先级": "P0", "结构化备注": "PM 保留结论",
    });
    const editBody = {
      expectedSourceVersion: 1,
      title: "导航偏航后重规划不稳定（补充场景）",
      description: "用户：城市通勤与训练骑行者。场景：复杂路口。现状：偏航提示慢。期望：快速重规划。",
    };
    const edited = await h.api("PATCH", `/api/requirements/${manualId}`, editBody, { "Idempotency-Key": "verify-edit-key-0001" });
    equal("实质编辑 200 updated", [edited.status, edited.body.outcome], [200, "updated"]);
    equal("源版本 +1", edited.body.sourceVersion, 2);
    equal("实质变更标记 true", edited.body.substantiveChanged, true);
    versionAfterEdit = edited.body.sourceVersion;
    const row = await one("select * from requirements where id=$1", [manualId]);
    equal("编辑后分析回 pending", row?.analysis_state, "pending");
    equal("编辑后推送回 pending", row?.push_state, "pending");
    equal("新快照 v2", (await one<{ n: string }>("select count(*) n from source_snapshots where requirement_id=$1 and source_version=2", [manualId]))?.n, "1");
    equal("编辑审计", (await one<{ n: string }>("select count(*) n from audit_events where event_type='intake.updated' and entity_id=$1", [manualId]))?.n, "1");

    const replay = await h.api("PATCH", `/api/requirements/${manualId}`, editBody, { "Idempotency-Key": "verify-edit-key-0001" });
    equal("同键重放 outcome=replay", [replay.status, replay.body.outcome], [200, "replay"]);
    const keyConflict = await h.api("PATCH", `/api/requirements/${manualId}`, { ...editBody, title: "另一个标题" }, { "Idempotency-Key": "verify-edit-key-0001" });
    equal("同键不同内容 409", keyConflict.status, 409);
    const stale = await h.api("PATCH", `/api/requirements/${manualId}`, { expectedSourceVersion: 1, title: "过期版本标题" }, { "Idempotency-Key": "verify-edit-key-0002" });
    equal("旧源版本并发 409", stale.status, 409);
    check("409 文案带当前版本", String(stale.body?.error?.message ?? stale.text).includes("2"), stale.body);

    await h.drain();
    const refreshed = await one("select * from requirements where id=$1", [manualId]);
    equal("分析 v2 完成", refreshed?.analysis_state, "analyzed");
    equal("推送 v2 完成", refreshed?.push_state, "pushed");
    equal("Base 同一 recordId", refreshed?.base_record_id, manualBaseRecordId);
    const snapshot = await one("select * from pm_snapshots where requirement_id=$1 order by captured_at desc", [manualId]);
    check("实质变更前保存 PM 快照", Boolean(snapshot), snapshot);
    const pmValues = typeof snapshot?.pm_values === "string" ? JSON.parse(snapshot.pm_values) : snapshot?.pm_values ?? {};
    equal("PM 快照保留 Base 中的 PM状态", pmValues["PM状态"], "已采纳");
    equal("PM 快照保留 PM确认模块", pmValues["PM确认模块"], "方案设计");
    const baseRow = h.base.rows.get(manualBaseRecordId);
    equal("Base PM状态被重置为待处理", baseRow?.fields["PM状态"], "待处理");
    equal("Base AI分析版本=2", baseRow?.fields["AI分析版本"], "2");
    equal("Base 源版本=2", baseRow?.fields["源版本"], "2");
    equal("内容变更通知收件人=当前负责人 B", baseRow?.fields["系统通知收件人"], [{ id: "ou_manual_owner_b" }]);
    equal("内容变更通知类型=需求内容变更", baseRow?.fields["系统通知类型"], "需求内容变更");
    equal("Base 行仍只有一条平台键记录", (await one<{ n: string }>("select count(*) n from requirements where platform_requirement_id='RQ-000001'"))?.n, "1");

    // 元数据变更：只更新投影，不新增分析、不重置 PM。
    h.base.setPm(manualBaseRecordId, { "PM状态": "已采纳", "结构化备注": "PM 再次保留" });
    const meta = await h.api("PATCH", `/api/requirements/${manualId}`, { expectedSourceVersion: 2, supplementUrl: "https://example.com/feedback/456" }, { "Idempotency-Key": "verify-edit-key-0003" });
    equal("元数据编辑 200", [meta.status, meta.body.outcome, meta.body.substantiveChanged], [200, "updated", false]);
    equal("元数据编辑不改源版本", meta.body.sourceVersion, 2);
    const analysesBefore = (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n;
    await h.drain();
    equal("元数据编辑不新增分析版本", (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n, analysesBefore);
    equal("元数据编辑不重置 PM 状态", h.base.rows.get(manualBaseRecordId)?.fields["PM状态"], "已采纳");
    equal("元数据编辑不新增 PM 快照", (await one<{ n: string }>("select count(*) n from pm_snapshots where requirement_id=$1", [manualId]))?.n, "1");

    // PM 快照读取失败：Base 行不得被改写，恢复后可重试成功。
    h.base.readPmFails = true;
    const failingEdit = await h.api("PATCH", `/api/requirements/${manualId}`, { expectedSourceVersion: 2, title: "导航偏航后重规划不稳定（第三次）" }, { "Idempotency-Key": "verify-edit-key-0004" });
    equal("第三次实质编辑 200", failingEdit.status, 200);
    await h.drain();
    const failedRow = await one("select * from requirements where id=$1", [manualId]);
    equal("PM 快照失败时推送不成功", failedRow?.push_state, "failed");
    equal("PM 快照失败时 Base 行未被改写", h.base.rows.get(manualBaseRecordId)?.fields["标题"], editBody.title);
    equal("PM 快照失败不新增快照", (await one<{ n: string }>("select count(*) n from pm_snapshots where requirement_id=$1", [manualId]))?.n, "1");
    h.base.readPmFails = false;
    await h.pool.query("update pipeline_jobs set status='queued', available_at=now(), locked_until=null, attempt_count=0 where job_type='base_push' and status in ('failed','queued','running') and payload->>'requirementId'=$1", [manualId]);
    await h.drain();
    const recoveredRow = await one("select * from requirements where id=$1", [manualId]);
    equal("恢复后重试推送成功", recoveredRow?.push_state, "pushed");
    equal("恢复后 Base 标题为新内容", h.base.rows.get(manualBaseRecordId)?.fields["标题"], "导航偏航后重规划不稳定（第三次）");
    equal("恢复后新增 PM 快照", (await one<{ n: string }>("select count(*) n from pm_snapshots where requirement_id=$1", [manualId]))?.n, "2");
    versionAfterEdit = Number(recoveredRow?.source_version);
  }

  // ---------------------------------------------------------------- 人群
  section("S5 六层人群人工确认（V02-T09）");
  {
    const noSideEffectsBefore = {
      analyses: (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n,
      pushes: (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n,
    };
    const save1 = await h.api("PUT", `/api/requirements/${manualId}/audience`, { tags: ["L2", "L4"], expectedVersion: 0 });
    equal("首次保存人群 200", [save1.status, save1.body.audienceVersion, save1.body.confirmed], [200, 1, true]);
    const detail1 = await h.api("GET", `/api/requirements/${manualId}`);
    equal("详情读回 L2/L4 + 已确认", detail1.body.audience, { tags: ["L2", "L4"], confirmed: true, version: 1 });
    const save2 = await h.api("PUT", `/api/requirements/${manualId}/audience`, { tags: ["L1", "L2"], expectedVersion: 1 });
    equal("二次保存人群版本递增", [save2.status, save2.body.audienceVersion], [200, 2]);
    const conflict = await h.api("PUT", `/api/requirements/${manualId}/audience`, { tags: ["L3"], expectedVersion: 1 });
    equal("人群乐观冲突 409", conflict.status, 409);
    const empty = await h.api("PUT", `/api/requirements/${manualId}/audience`, { tags: [], expectedVersion: 2 });
    equal("明确空集合保存成功", [empty.status, empty.body.audienceVersion], [200, 3]);
    const detail2 = await h.api("GET", `/api/requirements/${manualId}`);
    equal("空集合=已确认空（区别于未确认）", detail2.body.audience, { tags: [], confirmed: true, version: 3 });
    equal("人群保存不触发分析", (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n, noSideEffectsBefore.analyses);
    equal("人群保存不触发 Base 推送", (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n, noSideEffectsBefore.pushes);
    equal("人群保存不改 PM 状态", h.base.rows.get(manualBaseRecordId)?.fields["PM状态"], "待处理");
    equal("人群审计累计 3 条", (await one<{ n: string }>("select count(*) n from audit_events where event_type='audience.updated' and entity_id=$1", [manualId]))?.n, "3");

    const retry = await h.api("POST", `/api/analysis/${manualId}/retry`);
    equal("人工重跑分析 202", retry.status, 202);
    await h.drain();
    const detail3 = await h.api("GET", `/api/requirements/${manualId}`);
    equal("AI 重跑不覆盖人工人群", detail3.body.audience, { tags: [], confirmed: true, version: 3 });
    equal("AI 重跑仍按规则产 P2", detail3.body.analysis?.priority, "P2");
  }

  // ---------------------------------------------------------------- RICE
  section("S6 RICE Beta（V02-T11/T12）");
  {
    const before = {
      analyses: (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n,
      pushes: (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n,
      priority: (await h.api("GET", `/api/requirements/${manualId}`)).body.analysis?.priority,
      pipeline: (await h.api("GET", `/api/requirements/${manualId}`)).body.pipeline,
    };
    const empty = await h.api("GET", `/api/requirements/${manualId}/rice-draft`);
    equal("RICE 初始状态待补充 / 无分数", [empty.status, empty.body.status, empty.body.score, empty.body.configVersion], [200, "待补充", null, "rice-v1"]);
    equal("RICE 量纲展示", [empty.body.units.reach, empty.body.units.effort], ["人次/月", "人周"]);
    const partial = await h.api("PUT", `/api/requirements/${manualId}/rice-draft`, { reach: "500", expectedEditVersion: 0 });
    equal("RICE 草稿可只填 Reach", [partial.status, partial.body.editVersion], [200, 1]);
    const partialRead = await h.api("GET", `/api/requirements/${manualId}/rice-draft`);
    equal("缺项仍待补充且不出分数", [partialRead.body.status, partialRead.body.score], ["待补充", null]);
    const full = await h.api("PUT", `/api/requirements/${manualId}/rice-draft`, { reach: "200", impact: "3", confidence: "80", effort: "4", expectedEditVersion: 1 });
    equal("RICE 完整输入保存", [full.status, full.body.editVersion], [200, 2]);
    const scored = await h.api("GET", `/api/requirements/${manualId}/rice-draft`);
    equal("RICE 手工复算 200×3×0.8÷4=120", scored.body.score, 120);
    equal("RICE 状态已计算", scored.body.status, "已计算");
    equal("RICE actor 留痕", scored.body.updatedBy, VERIFY_ACTOR);
    const zero = await h.api("PUT", `/api/requirements/${manualId}/rice-draft`, { effort: "0", expectedEditVersion: 2 });
    equal("Effort=0 可保存但不计算", [zero.status, zero.body.editVersion], [200, 3]);
    equal("Effort=0 不出分数", (await h.api("GET", `/api/requirements/${manualId}/rice-draft`)).body.score, null);
    const invalid = await h.api("PUT", `/api/requirements/${manualId}/rice-draft`, { confidence: "150", expectedEditVersion: 3 });
    equal("Confidence>100 不出分数", (await h.api("GET", `/api/requirements/${manualId}/rice-draft`)).body.score, null);
    const conflict = await h.api("PUT", `/api/requirements/${manualId}/rice-draft`, { reach: "1", expectedEditVersion: 1 });
    equal("RICE 并发冲突 409", conflict.status, 409);
    equal("RICE 历史版本累计", (await one<{ n: string }>("select count(*) n from rice_draft_history where requirement_id=$1", [manualId]))?.n, "4");
    const after = await h.api("GET", `/api/requirements/${manualId}`);
    equal("RICE 不改主优先级", after.body.analysis?.priority, before.priority);
    equal("RICE 不改主流水线", after.body.pipeline, before.pipeline);
    equal("RICE 不新增分析", (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n, before.analyses);
    equal("RICE 不新增 Base 推送", (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n, before.pushes);
  }

  // ---------------------------------------------------------------- Kano
  section("S7 Kano Beta（V02-T13/T14）");
  {
    const pii = await h.api("POST", "/api/kano/evidence", {
      title: "含个人信息访谈（合成）",
      summary: "联系人：李四，电话 13800138000，邮箱 lisi@example.com。",
      evidenceFragments: [{ ref: "S1", text: "用户认为导航稳定性是基础要求。" }],
      knownAudiences: ["L2"],
      coverageNotes: "L2/L3 访谈合并。",
    });
    equal("PII 资料导入被标记", [pii.status, pii.body.piiFlagged], [201, true]);
    const piiApprove = await h.api("POST", `/api/kano/evidence/${pii.body.id}/approve`);
    equal("PII 资料拒绝批准 409", piiApprove.status, 409);
    const clean = await h.api("POST", "/api/kano/evidence", {
      title: "合成访谈总结 v2（去标识化）",
      sourceUrl: "https://example.com/interview/summary-v2",
      sourceSection: "导航与路线",
      summary: "合成验收资料：骑行者重视导航稳定、偏航重规划与地图覆盖。",
      evidenceFragments: [
        { ref: "S1", text: "用户认为导航稳定性是基础要求。" },
        { ref: "S2", text: "偏航后若不能及时重规划，会打断训练节奏。" },
        { ref: "S3", text: "地图下载与区域选择存在覆盖问题。" },
      ],
      knownAudiences: ["L2", "L3"],
      knownScenes: "城市复杂路口、训练路线",
      coverageNotes: "L2/L3 访谈合并，L1 缺直接样本。",
      interviewDate: "2026-10-20",
    });
    equal("干净资料导入", [clean.status, clean.body.piiFlagged, clean.body.status], [201, false, "draft"]);
    const approved = await h.api("POST", `/api/kano/evidence/${clean.body.id}/approve`);
    equal("干净资料批准", [approved.status, approved.body.outcome], [200, "approved"]);
    const evidenceList = await h.api("GET", "/api/kano/evidence");
    equal("Kano 资料列表 2 版", evidenceList.body.items.length, 2);

    const before = {
      analyses: (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n,
      pushes: (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n,
      pushState: (await one("select push_state from requirements where id=$1", [manualId]))?.push_state,
    };
    const run1 = await h.api("POST", `/api/requirements/${manualId}/kano-runs`, { evidenceVersion: 2 });
    equal("Kano 手动触发 202", [run1.status, run1.body.runVersion, run1.body.status], [202, 1, "queued"]);
    await h.drain();
    const runs1 = await h.api("GET", `/api/requirements/${manualId}/kano-runs`);
    equal("Kano 报告落库", runs1.body.items.length, 1);
    const report = runs1.body.items[0];
    equal("Kano 运行成功", report.status, "succeeded");
    equal("Kano 永远标记 AI 假设（待验证）", report.result.researchStatus, "AI假设（待验证）");
    equal("Kano 提示词版本固定", report.promptVersion, "rq-kano-v1");
    equal("Kano 模型留痕", report.model, "controlled-kano-model-v1");
    equal("Kano 候选类型受控", report.result.capabilities[0].candidateType, "期望型");
    equal("Kano 引用真实资料片段", report.result.capabilities[0].evidence, ["S1"]);
    check("Kano 不输出样本量/比例/系数", !JSON.stringify(report.result).match(/(样本量|百分比|占比|系数)/), report.result);
    check("Kano 推演注明非真实作答", String(report.result.capabilities[0].simulatedLeaning.rationale).includes("不代表真实受访者"), report.result.capabilities[0].simulatedLeaning);
    equal("Kano 不改主推送状态", (await one("select push_state from requirements where id=$1", [manualId]))?.push_state, before.pushState);
    equal("Kano 不新增主分析", (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n, before.analyses);
    equal("Kano 不新增 Base 推送", (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n, before.pushes);
    check("Kano 提示词包含资料片段", h.kanoProvider.prompts[0]?.includes("导航稳定性是基础要求"), h.kanoProvider.prompts[0]?.slice(0, 200));

    const run2 = await h.api("POST", `/api/requirements/${manualId}/kano-runs`, { evidenceVersion: 2 });
    equal("显式重跑生成新版本", [run2.status, run2.body.runVersion], [202, 2]);
    await h.drain();
    equal("旧报告保留", (await h.api("GET", `/api/requirements/${manualId}/kano-runs`)).body.items.length, 2);

    h.kanoProvider.badRef = true;
    const run3 = await h.api("POST", `/api/requirements/${manualId}/kano-runs`, { evidenceVersion: 2 });
    equal("第三次 Kano 触发 202", run3.status, 202);
    await h.drain();
    const runs3 = await h.api("GET", `/api/requirements/${manualId}/kano-runs`);
    equal("伪造证据引用安全失败", runs3.body.items.find((item: any) => item.runVersion === 3)?.status, "failed");
    equal("Kano 失败不改主分析", (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n, before.analyses);
    h.kanoProvider.badRef = false;

    // 来源内容变更后，旧报告标记过期依据。
    const edit = await h.api("PATCH", `/api/requirements/${manualId}`, { expectedSourceVersion: 3, title: "导航偏航重规划不稳定（Kano 后更新）" }, { "Idempotency-Key": "verify-edit-key-0005" });
    equal("Kano 后实质编辑 200", edit.status, 200);
    await h.drain();
    const runsAfterEdit = await h.api("GET", `/api/requirements/${manualId}/kano-runs`);
    check("源内容变化后旧报告提示过期", runsAfterEdit.body.items.filter((item: any) => item.status === "succeeded").every((item: any) => item.staleInputs === true), runsAfterEdit.body.items);
    equal("Kano 不影响编辑后的主优先级", (await h.api("GET", `/api/requirements/${manualId}`)).body.analysis?.priority, "P2");
  }

  // ---------------------------------------------------------------- TB 同步
  section("S9 TB 同步 / 通用来源 / 平台键 / 同标题（V02-T01/T02/T03/T15）");
  let sourceId = "";
  const ids: Record<string, string> = {};
  {
    const source = await h.api("POST", "/api/sources", {
      projectName: "室外产品-码表软固件需求池", enabled: true, schedule: { enabled: false, weekday: null, time: null, timezone: null },
    });
    equal("创建来源 201", source.status, 201);
    sourceId = source.body.id;
    check("来源 DTO 不回传内部 ID", !("projectId" in source.body) && !("requirementTypeId" in source.body), source.body);
    // 模拟服务端已核对的字段映射（真实目标来源由既有配置提供；本验证只关心统一来源行为）。
    await h.pool.query("update source_configs set field_map=$2 where id=$1", [sourceId, JSON.stringify({ description: "desc" })]);

    const tbTasks = [
      { id: "tb-task-1", content: "同标题需求", executor_id: null, created: "2026-10-01T00:00:00.000Z", custom_fields: [{ _customfieldid: "desc", type: "rtf", value: [{ meta: { html: "<p>用户需要导航稳定</p>" } }] }] },
      { id: "tb-task-2", content: "同标题需求", executor_id: null, created: "2026-10-02T00:00:00.000Z", custom_fields: [{ _customfieldid: "desc", type: "rtf", value: [{ meta: { html: "<p>用户需要导航稳定</p>" } }] }] },
      { id: "tb-task-3", content: "导航重规划要快", executor_id: "tb-owner-1", created: "2026-10-03T00:00:00.000Z", custom_fields: [{ _customfieldid: "desc", type: "rtf", value: [{ meta: { html: "<p>偏航后需要快速重规划</p>" } }] }] },
      { id: "tb-task-4", content: "地图下载失败", executor_id: "tb-owner-2", created: "2026-10-04T00:00:00.000Z", custom_fields: [{ _customfieldid: "desc", type: "rtf", value: [{ meta: { html: "<p>地图下载容易中断</p>" } }] }] },
    ];
    h.setTbTasks(tbTasks);
    await h.repositories.people.upsertManual({
      sourceConfigId: sourceId, teambitionUserId: "tb-owner-1", teambitionDisplayName: "TB负责人一",
      feishuUserId: "ou_tb_owner_1", feishuIdType: "open_id", createdBy: VERIFY_ACTOR, now: new Date().toISOString(),
    });

    const sync = await h.api("POST", "/api/sync/run", { sourceId }, { "Idempotency-Key": "verify-sync-key-0001" });
    equal("触发同步 202", [sync.status, sync.body.status], [202, "running"]);
    const batchId = sync.body.batchId;
    const replay = await h.api("POST", "/api/sync/run", { sourceId }, { "Idempotency-Key": "verify-sync-key-0001" });
    equal("同键同步重放 202 同批次", [replay.status, replay.body.batchId], [202, batchId]);
    await h.drain();

    const batch = await one("select * from sync_batches where id=$1", [batchId]);
    equal("批次成功 4/4/0", [batch?.status, Number(batch?.total_count), Number(batch?.succeeded_count), Number(batch?.failed_count)], ["succeeded", 4, 4, 0]);
    equal("同步明细 4 条", (await one<{ n: string }>("select count(*) n from sync_items where batch_id=$1", [batchId]))?.n, "4");
    const completedAudit = await one("select * from audit_events where event_type='sync.completed' and entity_id=$1", [batchId]);
    const details = typeof completedAudit?.safe_details === "string" ? JSON.parse(completedAudit.safe_details) : completedAudit?.safe_details ?? {};
    equal("导入计数：取得 4 / 重复 0 / 处理 4", [details.fetched, details.duplicateIds, details.processed], [4, 0, 4]);

    const rows = await q("select * from requirements where source_config_id=$1 order by teambition_requirement_id", [sourceId]);
    equal("TB 需求全部导入", rows.length, 4);
    for (const row of rows) ids[String(row.teambition_requirement_id)] = String(row.id);
    equal("TB 来源类型", [...new Set(rows.map((row) => row.source_type))], ["teambition"]);
    equal("TB 全部已同步", [...new Set(rows.map((row) => row.pull_state))], ["synced"]);
    equal("RQ 编号跨来源连续且不碰撞", (await q<{ platform_requirement_id: string }>("select platform_requirement_id from requirements order by platform_requirement_id")).map((r) => r.platform_requirement_id), ["RQ-000001", "RQ-000002", "RQ-000003", "RQ-000004", "RQ-000005"]);
    equal("同标题两条均保留", rows.filter((row) => row.title === "同标题需求").length, 2);
    const canonical = await one("select * from requirements where id=$1", [ids["tb-task-1"]]);
    const duplicate = await one("select * from requirements where id=$1", [ids["tb-task-2"]]);
    equal("后出现同标题仅提示，不丢弃", duplicate?.duplicate_of_requirement_id, ids["tb-task-1"]);
    equal("疑似重复仍计入需求池", (await h.api("GET", "/api/requirements?q=同标题需求")).body.items.length, 2);
    equal("主记录 duplicateOf 为空", canonical?.duplicate_of_requirement_id, null);

    const tbBase = [...h.base.rows.values()].find((row) => String(row.fields["需求平台ID"]) === canonical?.platform_requirement_id);
    check("TB Base 行存在", Boolean(tbBase));
    equal("TB Base 行写 TB需求ID", tbBase?.fields["TB需求ID"], "tb-task-1");
    equal("TB Base 行写平台键", tbBase?.fields["需求平台ID"], canonical?.platform_requirement_id);
    equal("TB Base 行写需求说明（批准字段）", tbBase?.fields["需求说明"], "用户需要导航稳定");
    check("TB 无负责人首推不写执行人", (tbBase?.fields["执行人"] ?? null) === null, tbBase?.fields["执行人"]);
    check("TB 无负责人首推静默（无通知字段）", !("系统通知类型" in (tbBase?.fields ?? {})), Object.keys(tbBase?.fields ?? {}));

    const mapped = await one("select * from requirements where id=$1", [ids["tb-task-3"]]);
    equal("TB 有负责人且已映射 → manually_mapped（存量人工映射）", mapped?.owner_state, "manually_mapped");
    equal("TB 已映射需求推送完成", mapped?.push_state, "pushed");
    const mappedBase = h.base.rows.get(String(mapped?.base_record_id));
    equal("TB 映射负责人写入 Base", mappedBase?.fields["执行人"], [{ id: "ou_tb_owner_1" }]);
    const waiting = await one("select * from requirements where id=$1", [ids["tb-task-4"]]);
    equal("TB 未映射负责人 → pending_mapping", waiting?.owner_state, "pending_mapping");
    equal("未映射需求不误推 Base", [waiting?.push_state, waiting?.base_record_id], ["pending", null]);

    // source_only：只同步来源事实，不触发任何下游。
    const beforeSourceOnly = {
      analyses: (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n,
      pushes: (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n,
      reqs: (await one<{ n: string }>("select count(*) n from requirements"))?.n,
    };
    const sourceOnly = await h.api("POST", "/api/sync/run", { sourceId, mode: "source_only" }, { "Idempotency-Key": "verify-sync-source-only-0001" });
    equal("source_only 触发 202", sourceOnly.status, 202);
    await h.drain();
    equal("source_only 不新增分析", (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n, beforeSourceOnly.analyses);
    equal("source_only 不新增 Base 推送", (await one<{ n: string }>("select count(*) n from base_push_runs"))?.n, beforeSourceOnly.pushes);
    equal("source_only 不新增需求", (await one<{ n: string }>("select count(*) n from requirements"))?.n, beforeSourceOnly.reqs);

    // 全量重放：不新增需求/分析，不重编号。
    const idsBefore = (await q<{ id: string; platform_requirement_id: string }>("select id,platform_requirement_id from requirements order by platform_requirement_id")).map((row) => `${row.id}:${row.platform_requirement_id}`);
    const replay2 = await h.api("POST", "/api/sync/run", { sourceId }, { "Idempotency-Key": "verify-sync-replay-0002" });
    equal("全量重放 202", replay2.status, 202);
    await h.drain();
    const idsAfter = (await q<{ id: string; platform_requirement_id: string }>("select id,platform_requirement_id from requirements order by platform_requirement_id")).map((row) => `${row.id}:${row.platform_requirement_id}`);
    equal("全量重放不新增/不重编号", idsAfter, idsBefore);
    equal("全量重放不新增分析版本", (await one<{ n: string }>("select count(*) n from analysis_runs"))?.n, beforeSourceOnly.analyses);
    equal("同标题提示保持", (await one("select duplicate_of_requirement_id from requirements where id=$1", [ids["tb-task-2"]]))?.duplicate_of_requirement_id, ids["tb-task-1"]);

    // 负责人映射补齐后的自愈。
    await h.repositories.people.upsertManual({
      sourceConfigId: sourceId, teambitionUserId: "tb-owner-2", teambitionDisplayName: "TB负责人二",
      feishuUserId: "ou_tb_owner_2", feishuIdType: "open_id", createdBy: VERIFY_ACTOR, now: new Date().toISOString(),
    });
    const recheck = await recheckOwnerMappings({
      requirements: h.repositories.requirements,
      people: h.repositories.people,
      analyses: h.repositories.analyses,
      jobs: h.repositories.jobs,
      audit: h.repositories.audit,
      now: new Date(),
    });
    check("映射补齐后重新入队", recheck.enqueued >= 1, recheck);
    await h.drain();
    const healed = await one("select * from requirements where id=$1", [ids["tb-task-4"]]);
    equal("映射补齐后推送完成", healed?.push_state, "pushed");
    equal("映射补齐后 Base 执行人", h.base.rows.get(String(healed?.base_record_id))?.fields["执行人"], [{ id: "ou_tb_owner_2" }]);

    // TB 行拒绝 Web 编辑。
    const editTb = await h.api("PATCH", `/api/requirements/${ids["tb-task-1"]}`, { expectedSourceVersion: 1, title: "Web 改 TB" }, { "Idempotency-Key": "verify-edit-tb-0001" });
    equal("TB 事实只读 → 409", editTb.status, 409);
    check("409 文案说明 TB 由 TB 维护", String(editTb.body?.error?.message ?? "").includes("Teambition"), editTb.body);

    // 手工同标题与 TB 同标题互不合并。
    const manualSameTitle = await h.api("POST", "/api/requirements", {
      title: "同标题需求", description: "手工来源的同标题需求，必须独立保留。", sourceChannel: "销售",
    }, { "Idempotency-Key": "verify-intake-same-title-0001" });
    equal("手工同标题创建成功", manualSameTitle.status, 201);
    await h.drain();
    equal("手工同标题独立编号", manualSameTitle.body.platformRequirementId, "RQ-000006");
    equal("手工同标题不参与 TB 重复提示", (await one("select duplicate_of_requirement_id from requirements where id=$1", [manualSameTitle.body.requirementId]))?.duplicate_of_requirement_id, null);
    equal("同标题需求池总数 3", (await h.api("GET", "/api/requirements?q=同标题需求")).body.items.length, 3);

    // 批次契约与分页（F-02 回归）。
    const batches = await h.api("GET", "/api/batches");
    equal("批次列表 200", batches.status, 200);
    check("批次 DTO 使用 id 字段", typeof batches.body.items[0]?.id === "string" && !("batchId" in batches.body.items[0]), batches.body.items[0]);
    const batchDetail = await h.api("GET", `/api/batches/${batches.body.items[0].id}`);
    equal("批次详情 200", batchDetail.status, 200);
    check("批次详情 id 与列表一致", batchDetail.body.id === batches.body.items[0].id, batchDetail.body);
    const page1 = await h.api("GET", "/api/requirements?limit=2");
    check("需求分页游标存在", Boolean(page1.body.nextCursor));
    if (page1.body.nextCursor) {
      const page2 = await h.api("GET", `/api/requirements?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
      equal("第二页返回 2 条", page2.body.items.length, 2);
      check("分页无重复", !page2.body.items.some((item: any) => item.id === page1.body.items[0].id));
    }

    // Kano 对 TB 来源同样可用（V02-T17-AC05）。
    const tbKano = await h.api("POST", `/api/requirements/${ids["tb-task-3"]}/kano-runs`, { evidenceVersion: 2 });
    equal("TB 需求可用 Kano", tbKano.status, 202);
    await h.drain();
    const tbKanoList = await h.api("GET", `/api/requirements/${ids["tb-task-3"]}/kano-runs`);
    equal("TB 需求 Kano 成功", tbKanoList.body.items[0]?.status, "succeeded");

    // 非法 UUID 路径：记录当前行为（PRD 8.5 EQ-02 的回归观察；不列入第 7 节验收标准）。
    const invalid = await safeApi("GET", "/api/requirements/not-a-uuid");
    observe("非法路径 UUID 返回 4xx（EQ-02）", invalid.status === 400 || invalid.status === 404, invalid);
    const invalidBatch = await safeApi("GET", "/api/batches/not-a-uuid");
    observe("非法批次路径 UUID 返回 4xx（EQ-02）", invalidBatch.status === 400 || invalidBatch.status === 404, invalidBatch);
    const malformed = await safeApi("GET", "/api/requirements/%E0%A4%A");
    observe("畸形 URL 编码返回 4xx（EQ-02）", malformed.status >= 400 && malformed.status < 500, malformed);
  }

  // ---------------------------------------------------------------- 汇总
  section("汇总");
  const metrics = await h.api("GET", "/api/overview/metrics");
  equal("最终 6 条需求", metrics.body.counts.total, 6);
  equal("最终 6 条已推送", metrics.body.counts.pushPushed, 6);
  const audit = await h.api("GET", "/api/audit?limit=100");
  check("审计可读且无敏感值", Array.isArray(audit.body.items) && !JSON.stringify(audit.body.items).includes("13800138000"), audit.body.items?.length);
} finally {
  await h.pool.end();
}

process.stdout.write(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}\n`);
if (failures.length > 0) {
  process.stdout.write(`FAILED:\n${failures.map((name) => ` - ${name}`).join("\n")}\n`);
  process.exitCode = 1;
}
