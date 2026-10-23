import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresRepositories } from "./repositories.js";
import { createBasePushService } from "../../base/push-service.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../../../../");
async function getDatabaseUrl(){if(process.env.DATABASE_URL)return process.env.DATABASE_URL;const env=await readFile(resolve(root,".env"),"utf8").catch(()=>"");const value=env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();if(!value)throw new Error("PostgreSQL integration tests require DATABASE_URL in environment or repo .env");return value;}
async function setup(){const connectionString=await getDatabaseUrl();const admin=new Pool({connectionString,connectionTimeoutMillis:5000});const schema=`rq_test_${randomUUID().replaceAll("-","")}`;await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`,max:5});try{const sql=await readFile(resolve(root,"database/migrations/0001_initial.sql"),"utf8");await pool.query(sql);const next=await readFile(resolve(root,"database/migrations/0002_single_source_config.sql"),"utf8");await pool.query(next);const platformId=await readFile(resolve(root,"database/migrations/0004_platform_requirement_id.sql"),"utf8");await pool.query(platformId);const platformIdBackfill=await readFile(resolve(root,"database/migrations/0005_platform_requirement_id_backfill.sql"),"utf8");await pool.query(platformIdBackfill);const manualOwner=await readFile(resolve(root,"database/migrations/0006_requirement_manual_owner.sql"),"utf8");await pool.query(manualOwner);const ownerAndDuplicates=await readFile(resolve(root,"database/migrations/0007_requirement_owner_conflict_duplicates.sql"),"utf8");await pool.query(ownerAndDuplicates);return{pool,admin,schema,repos:new PostgresRepositories(pool as never)};}catch(error){await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();throw error;}}
async function cleanup(ctx:{pool:Pool;admin:Pool;schema:string}){await ctx.pool.end();await ctx.admin.query(`DROP SCHEMA "${ctx.schema}" CASCADE`);await ctx.admin.end();}
const config={projectId:"tb-project",projectName:"Product",requirementTypeId:"req-type",enabled:true,schedule:{enabled:true,weekday:1,time:"09:30",timezone:"Asia/Shanghai"},ownerNames:["PM Owner"],fieldMap:{description:"cf-description"}};
function requirementWrite(sourceConfigId:string, latestBatchId:string, overrides:Partial<import("./repositories.js").RequirementRowWrite>={}) {
  return { sourceConfigId, teambitionRequirementId:"task-1", title:"Requirement", description:null, scope:null, acceptanceCriteria:null, proposerUserId:null, proposerName:null, executorUserId:null, executorName:null, statusId:null, createdAt:null, updatedAt:null, sourceUrl:null, uniqueId:null, attachmentRefs:[], customFields:[], payload:{}, sourceHash:"a".repeat(64), substantiveHash:"b".repeat(64), sourceVersion:1, latestBatchId, ...overrides };
}
test("source configuration create/get persists a minute-precision schedule, owner names and field map",async()=>{const ctx=await setup();try{const created=await ctx.repos.sources.create(config);const loaded=await ctx.repos.sources.get(created.id);assert.equal(created.externalProjectId,"tb-project");assert.equal(loaded?.requirementTypeId,"req-type");assert.equal(created.scheduleEnabled,true);assert.equal(created.scheduleWeekday,1);assert.equal(created.scheduleLocalTime,"09:30");assert.equal(loaded?.scheduleLocalTime,"09:30");assert.equal(created.scheduleTimezone,"Asia/Shanghai");assert.deepEqual(created.ownerNames,["PM Owner"]);assert.deepEqual(created.fieldMap,{description:"cf-description"});}finally{await cleanup(ctx);}});
test("source config mutation and audit append share one transaction",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create(config);const event={id:"00000000-0000-4000-8000-000000000111",actorId:null,eventType:"source.updated",entityType:"source_config",entityId:source.id,result:"succeeded" as const,safeDetails:{},occurredAt:"2026-10-08T00:00:00Z"};await ctx.repos.audit.append(event);await assert.rejects(()=>ctx.repos.sources.update(source.id,{projectId:"changed",projectName:"Changed",requirementTypeId:"req-type",enabled:true,schedule:{enabled:false,weekday:null,time:null,timezone:null},ownerNames:[],fieldMap:{}},event));assert.equal((await ctx.repos.sources.get(source.id))?.externalProjectId,config.projectId);}finally{await cleanup(ctx);}});
test("MVP source configuration is database-enforced as a singleton",async()=>{const ctx=await setup();try{await ctx.repos.sources.create(config);await assert.rejects(()=>ctx.repos.sources.create({...config,projectId:"another-project"}),{code:"23505"});}finally{await cleanup(ctx);}});
test("requirements receive stable sequential RQ IDs without changing the TB upsert key",async()=>{
  const ctx=await setup();
  try{
    const source=await ctx.repos.sources.create(config);
    const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"platform-id-batch-0001",startedAt:"2026-10-08T00:00:00Z"});
    const first=await ctx.repos.requirements.upsertRequirement(source.id,"task-1",requirementWrite(source.id,batch.id));
    assert.equal((await ctx.repos.requirements.get(first.id))?.platformRequirementId,"RQ-000001");
    const replay=await ctx.repos.requirements.upsertRequirement(source.id,"task-1",requirementWrite(source.id,batch.id));
    assert.equal(replay.id,first.id);
    assert.equal(replay.created,false);
    assert.equal((await ctx.repos.requirements.get(replay.id))?.platformRequirementId,"RQ-000001");
    const second=await ctx.repos.requirements.upsertRequirement(source.id,"task-2",requirementWrite(source.id,batch.id,{teambitionRequirementId:"task-2"}));
    assert.equal((await ctx.repos.requirements.get(second.id))?.platformRequirementId,"RQ-000002");
  }finally{await cleanup(ctx);}
});
test("sync batch create is idempotent and blocks a parallel active batch",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create(config);const p={sourceConfigId:source.id,triggerType:"manual" as const,actorId:null,idempotencyKey:"manual-key-0001",startedAt:"2026-10-08T00:00:00Z"};const one=await ctx.repos.batches.create(p);assert.equal((await ctx.repos.batches.create(p)).id,one.id);await assert.rejects(()=>ctx.repos.batches.create({...p,idempotencyKey:"manual-key-0002"}),{name:"ActiveBatchConflict"});}finally{await cleanup(ctx);}});
test("persistent job queue claims a lease and completes the job with fencing",async()=>{const ctx=await setup();try{const job=await ctx.repos.jobs.enqueue({jobType:"sync",dedupeKey:"job-1",payload:{sourceId:"s"},availableAt:"2026-10-08T00:00:00Z"});const claimed=await ctx.repos.jobs.claimNext("worker",30000,"2026-10-08T00:00:01Z");assert.equal(claimed?.id,job.id);assert.equal(claimed?.attemptCount,1);const stale=await ctx.repos.jobs.claimNext("worker-b",30000,"2026-10-08T00:00:35Z");assert.equal(stale?.attemptCount,2);assert.equal(await ctx.repos.jobs.complete(job.id,{expectedAttempt:1,status:"succeeded",now:"2026-10-08T00:00:40Z"}),null);const recovered=await ctx.repos.jobs.complete(job.id,{expectedAttempt:2,status:"succeeded",now:"2026-10-08T00:00:40Z"});assert.equal(recovered?.status,"succeeded");}finally{await cleanup(ctx);}});

test("fixture rejection settles its batch atomically and a stale claimant cannot overwrite recovery", async () => {
  const ctx = await setup();
  try {
    const source = await ctx.repos.sources.create(config);
    const batch = await ctx.repos.batches.create({ sourceConfigId: source.id, triggerType: "scheduled", actorId: null, idempotencyKey: "fixture-rejection-1", startedAt: "2026-10-08T00:00:00Z" });
    const job = await ctx.repos.jobs.enqueue({ jobType: "sync", dedupeKey: "fixture-rejection-job", payload: { batchId: batch.id }, availableAt: "2026-10-08T00:00:00Z" });
    await ctx.repos.jobs.claimNext("worker-a", 1000, "2026-10-08T00:00:01Z");
    await ctx.repos.jobs.claimNext("worker-b", 1000, "2026-10-08T00:00:03Z");
    const stale = { expectedAttempt: 1, status: "failed" as const, errorCode: "fixture_policy_denied", errorSummary: "Fixture rejected", now: "2026-10-08T00:00:04Z", settleSyncBatch: true };
    assert.equal(await ctx.repos.jobs.complete(job.id, stale), null);
    assert.equal((await ctx.repos.batches.get(batch.id))?.status, "running");
    await ctx.repos.jobs.complete(job.id, { ...stale, expectedAttempt: 2 });
    assert.equal((await ctx.repos.batches.get(batch.id))?.status, "failed");
    const next = await ctx.repos.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: null, idempotencyKey: "fixture-recovery-2", startedAt: "2026-10-08T00:00:05Z" });
    assert.notEqual(next.id, batch.id);
    await ctx.repos.batches.complete(batch.id, { status: "succeeded", totalCount: 1, succeededCount: 1, failedCount: 0, errorSummary: null, completedAt: "2026-10-08T00:00:06Z" });
    assert.equal(await ctx.repos.jobs.complete(job.id, stale), null);
    assert.equal((await ctx.repos.batches.get(batch.id))?.status, "succeeded");
  } finally { await cleanup(ctx); }
});
test("analysis records append versions and keep the earlier run",async()=>{const ctx=await setup();try{const s=await ctx.repos.sources.create(config);const syncBatch=await ctx.repos.batches.create({sourceConfigId:s.id,triggerType:"manual",actorId:null,idempotencyKey:"analysis-requirement-0001",startedAt:"2026-10-08T00:00:00Z"});const r=await ctx.repos.requirements.upsertRequirement(s.id,"task-1",requirementWrite(s.id,syncBatch.id,{title:"A"}));const a=await ctx.repos.analyses.append({requirementId:r.id,sourceVersion:1,analysisVersion:1,startedAt:"2026-10-08T00:00:00Z"});await ctx.repos.analyses.complete(a.id,{status:"failed_retryable",safeErrorCode:"PROVIDER_TIMEOUT",completedAt:"2026-10-08T00:00:01Z"});const b=await ctx.repos.analyses.append({requirementId:r.id,sourceVersion:1,analysisVersion:2,startedAt:"2026-10-08T00:00:02Z"});assert.equal((await ctx.repos.analyses.listByRequirement(r.id)).length,2);assert.equal((await ctx.repos.analyses.latest(r.id))?.id,b.id);}finally{await cleanup(ctx);}});
test("analysis completion rejects a result produced for a stale source version",async()=>{const ctx=await setup();try{const s=await ctx.repos.sources.create(config);const b=await ctx.repos.batches.create({sourceConfigId:s.id,triggerType:"manual",actorId:null,idempotencyKey:"analysis-stale-0001",startedAt:"2026-10-08T00:00:00Z"});const r=await ctx.repos.requirements.upsertRequirement(s.id,"task-stale",requirementWrite(s.id,b.id,{teambitionRequirementId:"task-stale"}));const run=await ctx.repos.analyses.append({requirementId:r.id,sourceVersion:1,analysisVersion:1,startedAt:"2026-10-08T00:00:01Z"});await ctx.repos.requirements.upsertRequirement(s.id,"task-stale",requirementWrite(s.id,b.id,{teambitionRequirementId:"task-stale",sourceHash:"e".repeat(64),sourceVersion:2}));assert.equal(await ctx.repos.analyses.complete(run.id,{status:"analyzed",completedAt:"2026-10-08T00:00:02Z"}),null);}finally{await cleanup(ctx);}});
test("PM snapshots and audit events persist and can be read",async()=>{const ctx=await setup();try{const s=await ctx.repos.sources.create(config);const b=await ctx.repos.batches.create({sourceConfigId:s.id,triggerType:"manual",actorId:null,idempotencyKey:"snapshot-requirement-0001",startedAt:"2026-10-08T00:00:00Z"});const r=await ctx.repos.requirements.upsertRequirement(s.id,"task-1",requirementWrite(s.id,b.id,{sourceHash:"c".repeat(64),substantiveHash:"d".repeat(64),title:"B"}));await ctx.repos.pmSnapshots.append({requirementId:r.id,sourceVersion:1,baseRecordId:"rec-1",pmValues:{status:"待处理"},capturedAt:"2026-10-08T00:00:00Z"});assert.equal((await ctx.repos.pmSnapshots.latest(r.id))?.baseRecordId,"rec-1");await ctx.repos.audit.append({id:"00000000-0000-4000-8000-000000000001",actorId:null,eventType:"sync",entityType:"requirement",entityId:r.id,result:"succeeded",safeDetails:{},occurredAt:"2026-10-08T00:00:00Z"});assert.equal((await ctx.repos.audit.search({entityId:r.id,limit:5})).length,1);}finally{await cleanup(ctx);}});

test("requirement upsert round-trips source URL and latest batch",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create(config);const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"requirement-url-0001",startedAt:"2026-10-08T00:00:00Z"});const created=await ctx.repos.requirements.upsertRequirement(source.id,"task-url",requirementWrite(source.id,batch.id,{teambitionRequirementId:"task-url",sourceUrl:"https://example.test/requirements/task-url"}));const persisted=await ctx.repos.requirements.get(created.id);assert.equal(persisted?.sourceUrl,"https://example.test/requirements/task-url");assert.equal(persisted?.latestBatchId,batch.id);}finally{await cleanup(ctx);}});
test("requirement search keyset cursor returns a second page",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create(config);const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"search-cursor-0001",startedAt:"2026-10-08T00:00:00Z"});for(const [index,id] of ["one","two","three"].entries()){await ctx.pool.query("INSERT INTO requirements(id,source_config_id,teambition_requirement_id,title,source_hash,substantive_hash,latest_batch_id,created_at,platform_requirement_id) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8)",[randomUUID(),source.id,id,"a".repeat(64),"b".repeat(64),batch.id,"2026-10-08T00:00:00Z",`RQ-${String(index+1).padStart(6,"0")}`]);}const first=await ctx.repos.requirements.search({limit:1});assert.equal(first.items.length,1);assert.ok(first.nextCursor);const { decodeRequirementCursor }=await import("../../application/requirement-cursor.js");const second=await ctx.repos.requirements.search({limit:1,cursor:decodeRequirementCursor(first.nextCursor)!});assert.equal(second.items.length,1);assert.notEqual(second.items[0]?.id,first.items[0]?.id);}finally{await cleanup(ctx);}});
test("suspected duplicates are excluded from the pool/counts but keep detail links and never enter Base",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create(config);const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"duplicate-flag-0001",startedAt:"2026-10-08T00:00:00Z"});const canonical=await ctx.repos.requirements.upsertRequirement(source.id,"tb-a",requirementWrite(source.id,batch.id,{teambitionRequirementId:"tb-a",title:"同一个诉求",createdAt:"2026-01-01T00:00:00Z"}));const duplicate=await ctx.repos.requirements.upsertRequirement(source.id,"tb-b",requirementWrite(source.id,batch.id,{teambitionRequirementId:"tb-b",title:"同一个诉求",createdAt:"2026-02-01T00:00:00Z"}));const candidates=await ctx.repos.requirements.listTitleCandidates(source.id);assert.equal(candidates.length,2);await ctx.repos.requirements.setDuplicateOf(duplicate.id,canonical.id);const page=await ctx.repos.requirements.search({limit:10});assert.deepEqual(page.items.map((item)=>item.id),[canonical.id]);assert.deepEqual(await ctx.repos.requirements.listDuplicates(canonical.id),[{id:duplicate.id,title:"同一个诉求",teambitionRequirementId:"tb-b"}]);const counts=await ctx.repos.requirements.getPipelineCounts();assert.equal(counts.total,1);await ctx.repos.requirements.markLastPushedOwner(canonical.id,{feishuUserId:"u-owner",feishuIdType:"user_id"});assert.deepEqual((await ctx.repos.requirements.get(canonical.id))?.lastPushedOwner,{feishuUserId:"u-owner",feishuIdType:"user_id"});}finally{await cleanup(ctx);}});

test("batch keyset cursor does not skip rows with identical start times and applies inclusive time filters",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create(config);const ids:string[]=[];for(let i=0;i<3;i++){const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:`same-time-batch-${i}`,startedAt:"2026-10-08T00:00:00Z"});ids.push(batch.id);await ctx.repos.batches.complete(batch.id,{status:"succeeded",totalCount:0,succeededCount:0,failedCount:0,errorSummary:null,completedAt:"2026-10-08T00:00:01Z"});}const first=await ctx.repos.batches.list({since:"2026-10-08T00:00:00Z",until:"2026-10-08T00:00:00Z",limit:1});assert.equal(first.items.length,1);assert.ok(first.nextCursor);const {decodeBatchCursor}=await import("../../application/batch-cursor.js");const second=await ctx.repos.batches.list({since:"2026-10-08T00:00:00Z",until:"2026-10-08T00:00:00Z",limit:1,cursor:decodeBatchCursor(first.nextCursor)!});assert.equal(second.items.length,1);assert.notEqual(second.items[0]?.id,first.items[0]?.id);assert.equal(ids.length,3);}finally{await cleanup(ctx);}});

test("changed source upsert atomically snapshots, resets analysis and push, and only clears owner mapping when the TB owner changes",async()=>{
  const ctx=await setup();
  try{
    const source=await ctx.repos.sources.create(config);
    const batch1=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"source-version-0001",startedAt:"2026-10-08T00:00:00Z"});
    const first=await ctx.repos.requirements.upsertRequirement(source.id,"task-owner",requirementWrite(source.id,batch1.id,{teambitionRequirementId:"task-owner",executorUserId:"tb-owner-1",executorName:"Ada",snapshot:{payload:{version:1},isSubstantiveChange:false,capturedAt:"2026-10-08T00:00:00Z"}}));
    await ctx.repos.batches.complete(batch1.id,{status:"succeeded",totalCount:1,succeededCount:1,failedCount:0,errorSummary:null,completedAt:"2026-10-08T00:00:01Z"});
    await ctx.repos.requirements.setOwner(first.id,"ou-owner-1","manually_mapped");
    await ctx.repos.requirements.updateAnalysisState(first.id,"running");await ctx.repos.requirements.updateAnalysisState(first.id,"analyzed");
    await ctx.repos.requirements.setPushState(first.id,"running");await ctx.repos.requirements.setPushState(first.id,"pushed");
    const batch2=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"source-version-0002",startedAt:"2026-10-09T00:00:00Z"});
    const second=await ctx.repos.requirements.upsertRequirement(source.id,"task-owner",requirementWrite(source.id,batch2.id,{teambitionRequirementId:"task-owner",executorUserId:"tb-owner-1",executorName:"Ada",sourceHash:"c".repeat(64),substantiveHash:"e".repeat(64),sourceVersion:2,snapshot:{payload:{version:2},isSubstantiveChange:true,capturedAt:"2026-10-09T00:00:00Z"}}));
    await ctx.repos.batches.complete(batch2.id,{status:"succeeded",totalCount:1,succeededCount:1,failedCount:0,errorSummary:null,completedAt:"2026-10-09T00:00:01Z"});
    const afterContentUpdate=await ctx.repos.requirements.get(second.id);
    assert.equal(afterContentUpdate?.pipeline.analysis,"pending");assert.equal(afterContentUpdate?.pipeline.push,"pending");assert.equal(afterContentUpdate?.pipeline.owner,"manually_mapped");
    assert.equal((await ctx.repos.sourceSnapshots.latest(second.id))?.sourceVersion,2);
    const batch3=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"source-version-0003",startedAt:"2026-10-10T00:00:00Z"});
    await ctx.repos.requirements.upsertRequirement(source.id,"task-owner",requirementWrite(source.id,batch3.id,{teambitionRequirementId:"task-owner",executorUserId:"tb-owner-2",executorName:"Bea",sourceHash:"d".repeat(64),substantiveHash:"e".repeat(64),sourceVersion:3,snapshot:{payload:{version:3},isSubstantiveChange:false,capturedAt:"2026-10-10T00:00:00Z"}}));
    assert.equal((await ctx.repos.requirements.get(second.id))?.pipeline.owner,"pending_mapping");
    assert.equal((await ctx.repos.sourceSnapshots.latest(second.id))?.sourceVersion,3);
  }finally{await cleanup(ctx);}
});
test("sync item persists orchestrator started time",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create(config);const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"item-start-0001",startedAt:"2026-10-08T00:00:00Z"});const wrote=await ctx.repos.items.upsert({batchId:batch.id,requirementId:null,teambitionRequirementId:"task-start",action:"created",status:"succeeded",startedAt:"2026-10-08T00:00:05Z",completedAt:"2026-10-08T00:00:10Z"});assert.equal(wrote.startedAt,"2026-10-08T00:00:05.000Z");}finally{await cleanup(ctx);}});

test("PM snapshot wiring keys on the database requirement id, never the Teambition id", async () => {
  // 回归守卫：BasePushInput 同时携带两个标识——requirementId 是 TB 的 24 位字符串（写 Base 字段用），
  // requirementDbId 是 requirements.id（uuid，pm_snapshots 的外键）。早期实现把 TB ID 传进
  // pm_snapshots.requirement_id（uuid 列），PG 报 22P02，导致"实质变更后再次推送"永远失败，
  // 且首次创建绕过快照所以测试看不出来。这里用真实仓储 + 真实列类型锁住接线。
  const ctx = await setup();
  try {
    const s = await ctx.repos.sources.create(config);
    const b = await ctx.repos.batches.create({ sourceConfigId: s.id, triggerType: "manual", actorId: null, idempotencyKey: "pm-snapshot-wiring-0001", startedAt: "2026-10-08T00:00:00Z" });
    const r = await ctx.repos.requirements.upsertRequirement(s.id, "6a951b81648c3a16a805d619", requirementWrite(s.id, b.id, { sourceHash: "e".repeat(64), substantiveHash: "f".repeat(64), title: "Snapshot wiring" }));
    const capturedAt = "2026-10-08T00:00:00Z";

    // 正确接线：DB uuid 能写入
    await ctx.repos.pmSnapshots.append({ requirementId: r.id, sourceVersion: 1, baseRecordId: "rec-1", pmValues: { "PM状态": "已采纳" }, capturedAt });
    assert.equal((await ctx.repos.pmSnapshots.latest(r.id))?.baseRecordId, "rec-1");

    // 缺陷形态：把 TB 的 24 位字符串 ID 写进 uuid 列会被 PostgreSQL 直接拒绝（原 bug 的症状）
    await assert.rejects(
      () => ctx.repos.pmSnapshots.append({ requirementId: "6a951b81648c3a16a805d619", sourceVersion: 1, baseRecordId: "rec-2", pmValues: {}, capturedAt }),
      /invalid input syntax for type uuid|22P02/i,
    );
  } finally {
    await cleanup(ctx);
  }
});

test("requirement advisory lock serializes the same requirement and releases on failure", async () => {
  // 并发锁取证：同一需求的第二个关键区必须等第一个事务提交后才开始；锁随事务结束自动释放，
  // 因此 fn 抛错（ROLLBACK）后同 id 仍可再次取得锁。
  const ctx = await setup();
  try {
    const withLock = ctx.repos.requirements.withRequirementLock;
    assert.ok(withLock, "Postgres 仓储必须实现 withRequirementLock");
    let active = 0;
    let maxActive = 0;
    const events: string[] = [];
    const section = async (label: string) => withLock.call(ctx.repos.requirements, "requirement-lock-1", async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`${label}:start`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      events.push(`${label}:end`);
      active -= 1;
      return label;
    });
    const [left, right] = await Promise.all([section("a"), section("b")]);
    assert.deepEqual([left, right], ["a", "b"]);
    assert.equal(maxActive, 1, `同一需求的并发关键区不得重叠: ${events.join(",")}`);
    const firstEnd = events.findIndex((event) => event.endsWith(":end"));
    assert.ok(firstEnd >= 1);
    assert.ok(events.slice(firstEnd + 1).some((event) => event.endsWith(":start")), `第二个关键区必须在第一个结束后开始: ${events.join(",")}`);

    await assert.rejects(() => withLock.call(ctx.repos.requirements, "requirement-lock-2", async () => { throw new Error("lock-scope failure"); }), /lock-scope failure/);
    assert.equal(await withLock.call(ctx.repos.requirements, "requirement-lock-2", async () => "after-failure"), "after-failure");
  } finally {
    await cleanup(ctx);
  }
});

test("concurrent pushes of the same requirement serialize through the advisory lock and write one Base row", async () => {
  // 端到端取证：真实 Postgres 仓储 + 推送服务 + 有延迟的 Base 桩。两次并发推送同一需求时，
  // 第二个必须在第一个事务提交后才能进入关键区；第一个已推送的 run 让第二个走幂等重放，
  // 因此只产生一次 Base 写入、一行 base_record_id，不出现两个 Base 行或相互覆盖。
  const ctx = await setup();
  try {
    const source = await ctx.repos.sources.create(config);
    const batch = await ctx.repos.batches.create({ sourceConfigId: source.id, triggerType: "manual", actorId: null, idempotencyKey: "lock-e2e-0001", startedAt: "2026-10-08T00:00:00Z" });
    const created = await ctx.repos.requirements.upsertRequirement(source.id, "task-lock", requirementWrite(source.id, batch.id, { teambitionRequirementId: "task-lock" }));
    let baseWrites = 0;
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const service = createBasePushService({
      requirements: ctx.repos.requirements,
      people: ctx.repos.people,
      basePushes: ctx.repos.basePushes,
      audit: ctx.repos.audit,
      analyses: ctx.repos.analyses,
      sourceSnapshots: ctx.repos.sourceSnapshots,
      base: {
        async push() {
          baseWrites += 1;
          activeWrites += 1;
          maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
          activeWrites -= 1;
          return { recordId: `base-rec-${baseWrites}`, created: false, omittedFields: [] };
        },
      } as never,
      sourceProjectId: source.externalProjectId,
      baseFields: { projectId: "project", requirementId: "requirement", owner: "owner", source: {}, ai: {}, pm: ["PM状态"] },
      actorId: "operator-1",
    });
    const idempotencyKey = "base-push:lock-e2e:v1";
    const [first, second] = await Promise.all([
      service.pushRequirement(created.id, idempotencyKey),
      service.pushRequirement(created.id, idempotencyKey),
    ]);
    assert.equal(first.kind, "pushed");
    assert.equal(second.kind, "pushed");
    assert.equal(baseWrites, 1, "同一需求不得产生第二次 Base 写入");
    assert.equal(maxActiveWrites, 1, "两个推送关键区的 Base 写入不得重叠");
    const reloaded = await ctx.repos.requirements.get(created.id);
    assert.equal(reloaded?.pipeline.push, "pushed");
    assert.equal(reloaded?.baseRecordId, "base-rec-1");
    assert.equal((await ctx.repos.basePushes.findByIdempotencyKey(idempotencyKey))?.status, "pushed");
  } finally {
    await cleanup(ctx);
  }
});

test("a no-TB-owner requirement keeps a per-requirement owner across syncs until it is cleared",async()=>{
  const ctx=await setup();
  try{
    const source=await ctx.repos.sources.create(config);
    const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"manual-owner-batch-1",startedAt:"2026-10-08T00:00:00Z"});
    const row=await ctx.repos.requirements.upsertRequirement(source.id,"task-1",requirementWrite(source.id,batch.id));
    await ctx.repos.requirements.setOwner(row.id,null,"not_required");
    assert.equal((await ctx.repos.requirements.get(row.id))?.manualOwner,null);
    await ctx.repos.requirements.assignManualOwner(row.id,{feishuUserId:"u-assignee",feishuIdType:"user_id",name:"毕梓浩",assignedBy:"operator",assignedAt:"2026-10-09T00:00:00.000Z"});
    let loaded=await ctx.repos.requirements.get(row.id);
    assert.equal(loaded?.pipeline.owner,"manually_mapped");
    assert.deepEqual(loaded?.manualOwner,{feishuUserId:"u-assignee",feishuIdType:"user_id",name:"毕梓浩",assignedBy:"operator",assignedAt:"2026-10-09T00:00:00.000Z",pushedFeishuUserId:null});
    // 人员映射表不受影响
    assert.deepEqual(await ctx.repos.people.listActive(source.id),[]);
    await ctx.repos.requirements.markManualOwnerPushed(row.id,"u-assignee");
    // 再次同步（源数据变化）不能抹掉人工负责人
    await ctx.repos.requirements.upsertRequirement(source.id,"task-1",requirementWrite(source.id,batch.id,{sourceHash:"c".repeat(64)}));
    loaded=await ctx.repos.requirements.get(row.id);
    assert.equal(loaded?.manualOwner?.feishuUserId,"u-assignee");
    assert.equal(loaded?.manualOwner?.pushedFeishuUserId,"u-assignee");
    // 改派：新负责人覆盖，但「已写入 Base 的负责人」保留到下一次推送成功
    await ctx.repos.requirements.assignManualOwner(row.id,{feishuUserId:"u-next",feishuIdType:"user_id",name:"盛永帮",assignedBy:"operator",assignedAt:"2026-10-10T00:00:00.000Z"});
    loaded=await ctx.repos.requirements.get(row.id);
    assert.equal(loaded?.manualOwner?.feishuUserId,"u-next");
    assert.equal(loaded?.manualOwner?.pushedFeishuUserId,"u-assignee");
    await ctx.repos.requirements.clearManualOwner(row.id);
    assert.equal((await ctx.repos.requirements.get(row.id))?.manualOwner,null);
  }finally{await cleanup(ctx);}
});
test("assigning a per-requirement owner to a missing requirement fails without side effects",async()=>{
  const ctx=await setup();
  try{
    const source=await ctx.repos.sources.create(config);
    const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"manual-owner-batch-2",startedAt:"2026-10-08T00:00:00Z"});
    const row=await ctx.repos.requirements.upsertRequirement(source.id,"task-1",requirementWrite(source.id,batch.id));
    await assert.rejects(()=>ctx.repos.requirements.assignManualOwner("00000000-0000-4000-8000-000000000999",{feishuUserId:"u",feishuIdType:"user_id",name:null,assignedBy:null,assignedAt:"2026-10-09T00:00:00.000Z"}),/not found/);
    assert.equal((await ctx.repos.requirements.get(row.id))?.manualOwner,null);
  }finally{await cleanup(ctx);}
});
