import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresRepositories } from "./repositories.js";
import { createBasePushService } from "../../base/push-service.js";
import { buildPriorityRule } from "../../analysis/priority-rule.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../../../../");
async function getDatabaseUrl(){if(process.env.DATABASE_URL)return process.env.DATABASE_URL;const env=await readFile(resolve(root,".env"),"utf8").catch(()=>"");const value=env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();if(!value)throw new Error("PostgreSQL integration tests require DATABASE_URL in environment or repo .env");return value;}
const MIGRATIONS_DIR=resolve(root,"database/migrations");
/**
 * 读取目录下全部迁移并按文件名顺序执行：手写清单会漏（此前漏了 0002_person_mapping_idempotency
 * 与 0003_team_directory_seed，测试库结构比生产少约束），新增迁移还得记得回来改。
 */
async function applyMigrations(pool:Pool){const{readdir}=await import("node:fs/promises");const files=(await readdir(MIGRATIONS_DIR)).filter((file)=>file.endsWith(".sql")).sort();for(const file of files)await pool.query(await readFile(resolve(MIGRATIONS_DIR,file),"utf8"));}
async function setup(){const connectionString=await getDatabaseUrl();const admin=new Pool({connectionString,connectionTimeoutMillis:5000});const schema=`rq_test_${randomUUID().replaceAll("-","")}`;await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`,max:5});try{await applyMigrations(pool);return{pool,admin,schema,repos:new PostgresRepositories(pool as never)};}catch(error){await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();throw error;}}
async function cleanup(ctx:{pool:Pool;admin:Pool;schema:string}){await ctx.pool.end();await ctx.admin.query(`DROP SCHEMA "${ctx.schema}" CASCADE`);await ctx.admin.end();}
const config={projectId:"tb-project",projectName:"Product",requirementTypeId:"req-type",enabled:true,schedule:{enabled:true,weekday:1,time:"09:30",timezone:"Asia/Shanghai"},ownerNames:["PM Owner"],fieldMap:{description:"cf-description"}};
function requirementWrite(sourceConfigId:string, latestBatchId:string, overrides:Partial<import("./repositories.js").RequirementRowWrite>={}) {
  return { sourceConfigId, teambitionRequirementId:"task-1", title:"Requirement", description:null, scope:null, acceptanceCriteria:null, proposerUserId:null, proposerName:null, executorUserId:null, executorName:null, statusId:null, createdAt:null, updatedAt:null, sourceUrl:null, uniqueId:null, attachmentRefs:[], customFields:[], payload:{}, sourceHash:"a".repeat(64), substantiveHash:"b".repeat(64), sourceVersion:1, latestBatchId, ...overrides };
}
test("source configuration create/get persists a minute-precision schedule, owner names and field map",async()=>{const ctx=await setup();try{const created=await ctx.repos.sources.create(config);const loaded=await ctx.repos.sources.get(created.id);assert.equal(created.externalProjectId,"tb-project");assert.equal(loaded?.requirementTypeId,"req-type");assert.equal(created.scheduleEnabled,true);assert.equal(created.scheduleWeekday,1);assert.equal(created.scheduleLocalTime,"09:30");assert.equal(loaded?.scheduleLocalTime,"09:30");assert.equal(created.scheduleTimezone,"Asia/Shanghai");assert.deepEqual(created.ownerNames,["PM Owner"]);assert.deepEqual(created.fieldMap,{description:"cf-description"});}finally{await cleanup(ctx);}});
test("source config round-trips the multi-weekday list",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create({...config,schedule:{...config.schedule,weekdays:[1,3,5]}});assert.deepEqual(source.scheduleWeekdays,[1,3,5]);const read=await ctx.repos.sources.get(source.id);assert.deepEqual(read?.scheduleWeekdays,[1,3,5]);assert.equal(read?.scheduleWeekday,1);}finally{await cleanup(ctx);}});
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
test("suspected duplicates stay in the pool/counts and keep detail links",async()=>{const ctx=await setup();try{const source=await ctx.repos.sources.create(config);const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"duplicate-flag-0001",startedAt:"2026-10-08T00:00:00Z"});const canonical=await ctx.repos.requirements.upsertRequirement(source.id,"tb-a",requirementWrite(source.id,batch.id,{teambitionRequirementId:"tb-a",title:"同一个诉求",createdAt:"2026-01-01T00:00:00Z"}));const duplicate=await ctx.repos.requirements.upsertRequirement(source.id,"tb-b",requirementWrite(source.id,batch.id,{teambitionRequirementId:"tb-b",title:"同一个诉求",createdAt:"2026-02-01T00:00:00Z"}));const candidates=await ctx.repos.requirements.listTitleCandidates(source.id);assert.equal(candidates.length,2);await ctx.repos.requirements.setDuplicateOf(duplicate.id,canonical.id);const page=await ctx.repos.requirements.search({limit:10});assert.deepEqual(page.items.map((item)=>item.id).sort(),[canonical.id,duplicate.id].sort());assert.deepEqual(await ctx.repos.requirements.listDuplicates(canonical.id),[{id:duplicate.id,title:"同一个诉求",teambitionRequirementId:"tb-b"}]);const counts=await ctx.repos.requirements.getPipelineCounts();assert.equal(counts.total,2);await ctx.repos.requirements.markLastPushedOwner(canonical.id,{feishuUserId:"u-owner",feishuIdType:"user_id"});assert.deepEqual((await ctx.repos.requirements.get(canonical.id))?.lastPushedOwner,{feishuUserId:"u-owner",feishuIdType:"user_id"});}finally{await cleanup(ctx);}});

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
    assert.deepEqual(loaded?.manualOwner,{feishuUserId:"u-assignee",feishuIdType:"user_id",name:"毕梓浩",assignedBy:"operator",assignedAt:"2026-10-09T00:00:00.000Z",pushedFeishuUserId:null,assignmentVersion:2});
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

test("V02-T02 manual intake: transactional create, idempotent replay, shared RQ allocator",async()=>{
  const ctx=await setup();
  try{
    const source=await ctx.repos.sources.create(config);
    const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"t02-tb-batch-0001",startedAt:"2026-10-08T00:00:00Z"});
    const tb=await ctx.repos.requirements.upsertRequirement(source.id,"task-1",requirementWrite(source.id,batch.id));
    assert.equal((await ctx.repos.requirements.get(tb.id))?.platformRequirementId,"RQ-000001");
    const manual=await ctx.repos.requirements.createManualRequirement({idempotencyKey:"intake-key-1",actorId:"operator-1",requestHash:"c".repeat(64),title:"售后反馈的诉求",description:"用户@张三 反馈…",sourceChannel:"售后",productModel:"码表 C606",requirementType:"体验优化",constraintNotes:"需兼容旧表带",supplementUrl:"https://example.com/t/1",intakeModule:"报表分析",owner:{feishuUserId:"u-assignee",feishuIdType:"user_id",name:"贾浩"}});
    if(!("requirementId" in manual)) throw new Error("expected created outcome");
    assert.equal(manual.replay,false);
    // 编号与 TB 分配器连续、不碰撞
    assert.equal(manual.platformRequirementId,"RQ-000002");
    const row=await ctx.repos.requirements.get(manual.requirementId);
    assert.equal(row?.sourceType,"web_manual");
    assert.equal(row?.sourceChannel,"售后");
    // V02-T05：精简上下文按录入原样读回，未知留空（AC03）
    assert.equal(row?.productModel,"码表 C606");
    assert.equal(row?.requirementType,"体验优化");
    assert.equal(row?.constraintNotes,"需兼容旧表带");
    assert.equal(row?.supplementUrl,"https://example.com/t/1");
    assert.equal(row?.sourceConfigId,null);
    assert.equal(row?.teambitionRequirementId,null);
    assert.equal(row?.pipeline.pull,"collected");
    // V02-T06：创建即指定负责人 → manually_mapped + 需求级 manual_owner（版本 1），不写 TB 人员映射
    assert.equal(row?.pipeline.owner,"manually_mapped");
    assert.equal(row?.manualOwner?.feishuUserId,"u-assignee");
    assert.equal(row?.manualOwner?.assignmentVersion,1);
    assert.equal(row?.intakeModule,"报表分析");
    assert.equal(row?.executorUserId,null);
    // 再次显式分配（改派）只影响这一条：分配版本递增
    await ctx.repos.requirements.assignManualOwner(manual.requirementId,{feishuUserId:"u-second",feishuIdType:"user_id",name:"李四",assignedBy:"operator-1",assignedAt:"2026-10-25T00:00:00.000Z"});
    const reassigned=await ctx.repos.requirements.get(manual.requirementId);
    assert.equal(reassigned?.manualOwner?.feishuUserId,"u-second");
    assert.equal(reassigned?.manualOwner?.assignmentVersion,2);
    // 同幂等键重放：同一需求，不再消耗编号
    const replay=await ctx.repos.requirements.createManualRequirement({idempotencyKey:"intake-key-1",actorId:"operator-1",requestHash:"c".repeat(64),title:"售后反馈的诉求",description:null,sourceChannel:"售后"});
    if(!("requirementId" in replay)) throw new Error("expected created outcome");
    assert.equal(replay.replay,true);
    assert.equal(replay.requirementId,manual.requirementId);
    const receipt=await ctx.repos.requirements.findIntakeReceipt("intake-key-1");
    assert.equal(receipt?.requirementId,manual.requirementId);
    // 手工需求也排了首分析作业（同一事务）
    const job=await ctx.repos.jobs.findByDedupeKey(`analysis:${manual.requirementId}:v1`);
    assert.equal(job?.jobType,"analysis");
    // 审计与需求同事务提交（V02-T04-AC04）
    const events=await ctx.repos.audit.search({entityId:manual.requirementId,limit:10});
    assert.equal(events.some((event)=>event.eventType==="intake.created"),true);
    // 统计不因空 TB ID 漏计手工行
    const counts=await ctx.repos.requirements.getPipelineCounts();
    assert.equal(counts.total,2);
  }finally{await cleanup(ctx);}
});
test("V02-T02 source branch constraints: TB rows require identity; manual rows reject TB identity",async()=>{
  const ctx=await setup();
  try{
    const source=await ctx.repos.sources.create(config);
    // teambition 分支缺 TB 身份 → 违反分支 CHECK
    await assert.rejects(()=>ctx.pool.query("INSERT INTO requirements(id,source_type,source_config_id,teambition_requirement_id,title,source_hash,substantive_hash,platform_requirement_id,pull_state,analysis_state,owner_state,push_state) VALUES($1,'teambition',NULL,NULL,'x',$2,$3,'RQ-000099','synced','pending','pending_mapping','pending')",[randomUUID(),"a".repeat(64),"b".repeat(64)]),{code:"23514"});
    // web_manual 分支带 TB 身份 → 违反分支 CHECK
    await assert.rejects(()=>ctx.pool.query("INSERT INTO requirements(id,source_type,source_config_id,teambition_requirement_id,title,source_hash,substantive_hash,platform_requirement_id,pull_state,analysis_state,owner_state,push_state) VALUES($1,'web_manual',$2,'tb-x','x',$3,$4,'RQ-000098','collected','pending','not_required','pending')",[randomUUID(),source.id,"a".repeat(64),"b".repeat(64)]),{code:"23514"});
    // 手工行不受 TB 唯一键约束：两条同标题手工需求独立保留（T15 口径）
    const first=await ctx.repos.requirements.createManualRequirement({idempotencyKey:"m-1",actorId:"a",requestHash:"1".repeat(64),title:"同标题诉求",description:null,sourceChannel:"运营"});
    if(!("requirementId" in first)) throw new Error("expected created outcome");
    const second=await ctx.repos.requirements.createManualRequirement({idempotencyKey:"m-2",actorId:"a",requestHash:"2".repeat(64),title:"同标题诉求",description:null,sourceChannel:"运营"});
    if(!("requirementId" in second)) throw new Error("expected created outcome");
    assert.notEqual(first.requirementId,second.requirementId);
  }finally{await cleanup(ctx);}
});

test("V02-T07 manual edit: substantive/metadata/no-change/version-conflict/TB-read-only/replay",async()=>{
  const ctx=await setup();
  try{
    const manual=await ctx.repos.requirements.createManualRequirement({idempotencyKey:"edit-m-1",actorId:"a1",requestHash:"1".repeat(64),title:"原始诉求",description:"原始描述",sourceChannel:"售后"});
    if(!("requirementId" in manual)) throw new Error("expected created outcome");
    // 实质变更：新版本 + 快照 + 分析任务 + 推送重置
    const substantive=await ctx.repos.requirements.updateManualRequirement({requirementId:manual.requirementId,expectedSourceVersion:1,idempotencyKey:"edit-k-1",actorId:"a1",requestHash:"2".repeat(64),title:"明确的诉求",description:"补充了期望结果"});
    assert.deepEqual(substantive,{outcome:"updated",sourceVersion:2,substantiveChanged:true,replay:false});
    const row1=await ctx.repos.requirements.get(manual.requirementId);
    assert.equal(row1?.title,"明确的诉求");
    assert.equal(row1?.sourceVersion,2);
    assert.equal(row1?.pipeline.analysis,"pending");
    assert.equal(row1?.pipeline.push,"pending");
    assert.ok(await ctx.repos.jobs.findByDedupeKey(`analysis:${manual.requirementId}:v2`));
    // 同键同内容重放：返回原结果，不产生 v3
    const replay=await ctx.repos.requirements.updateManualRequirement({requirementId:manual.requirementId,expectedSourceVersion:1,idempotencyKey:"edit-k-1",actorId:"a1",requestHash:"2".repeat(64),title:"ignored"});
    assert.equal(replay.outcome,"replay");
    assert.equal(replay.sourceVersion,2);
    // 同键不同内容：键冲突
    const keyConflict=await ctx.repos.requirements.updateManualRequirement({requirementId:manual.requirementId,expectedSourceVersion:2,idempotencyKey:"edit-k-1",actorId:"a1",requestHash:"3".repeat(64),title:"x"});
    assert.equal(keyConflict.outcome,"key_conflict");
    // 过期版本：明确冲突并返回当前版本
    const stale=await ctx.repos.requirements.updateManualRequirement({requirementId:manual.requirementId,expectedSourceVersion:1,idempotencyKey:"edit-k-2",actorId:"a1",requestHash:"4".repeat(64),title:"y"});
    assert.deepEqual(stale,{outcome:"version_conflict",currentSourceVersion:2});
    // 元数据变更：不加版本、不重跑分析，只更新投影并入队非实质推送
    const meta=await ctx.repos.requirements.updateManualRequirement({requirementId:manual.requirementId,expectedSourceVersion:2,idempotencyKey:"edit-k-3",actorId:"a1",requestHash:"5".repeat(64),sourceChannel:"运营/用研"});
    assert.deepEqual(meta,{outcome:"updated",sourceVersion:2,substantiveChanged:false,replay:false});
    const row2=await ctx.repos.requirements.get(manual.requirementId);
    assert.equal(row2?.sourceChannel,"运营/用研");
    assert.equal(row2?.sourceVersion,2);
    assert.equal(row2?.pipeline.analysis,"pending");
    // 无变化：不新建版本/任务
    const noop=await ctx.repos.requirements.updateManualRequirement({requirementId:manual.requirementId,expectedSourceVersion:2,idempotencyKey:"edit-k-4",actorId:"a1",requestHash:"6".repeat(64)});
    assert.deepEqual(noop,{outcome:"unchanged",sourceVersion:2,replay:false});
    // TB 行：手工编辑拒绝
    const source=await ctx.repos.sources.create(config);
    const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"edit-tb-batch",startedAt:"2026-10-25T00:00:00Z"});
    const tb=await ctx.repos.requirements.upsertRequirement(source.id,"tb-edit-1",requirementWrite(source.id,batch.id,{teambitionRequirementId:"tb-edit-1"}));
    const tbEdit=await ctx.repos.requirements.updateManualRequirement({requirementId:tb.id,expectedSourceVersion:1,idempotencyKey:"edit-k-5",actorId:"a1",requestHash:"7".repeat(64),title:"x"});
    assert.equal(tbEdit.outcome,"not_manual");
  }finally{await cleanup(ctx);}
});

test("V02-T09 audience tags: multi-select, confirmed-empty, optimistic version, no side effects",async()=>{
  const ctx=await setup();
  try{
    const manual=await ctx.repos.requirements.createManualRequirement({idempotencyKey:"aud-m-1",actorId:"a1",requestHash:"1".repeat(64),title:"训练人群诉求",description:"竞技用户需要训练计划",sourceChannel:"运营/用研"});
    if(!("requirementId" in manual)) throw new Error("expected created outcome");
    const before=await ctx.repos.requirements.get(manual.requirementId);
    assert.deepEqual(before?.audienceTags,[]);
    assert.equal(before?.audienceConfirmed,false);
    assert.equal(before?.audienceVersion,0);
    // 多选保存：confirmed=true、版本 1
    const first=await ctx.repos.requirements.setAudienceTags(manual.requirementId,{tags:["L2","L3"],expectedVersion:0,actorId:"pm-1"});
    assert.deepEqual(first,{outcome:"updated",version:1});
    const after=await ctx.repos.requirements.get(manual.requirementId);
    assert.deepEqual(after?.audienceTags,["L2","L3"]);
    assert.equal(after?.audienceConfirmed,true);
    // 乐观版本：旧版本冲突并返回当前版本
    const stale=await ctx.repos.requirements.setAudienceTags(manual.requirementId,{tags:["L1"],expectedVersion:0,actorId:"pm-1"});
    assert.deepEqual(stale,{outcome:"version_conflict",currentVersion:1});
    // 明确空集也是有效确认（区分未确认）
    const emptied=await ctx.repos.requirements.setAudienceTags(manual.requirementId,{tags:[],expectedVersion:1,actorId:"pm-1"});
    assert.equal(emptied.outcome,"updated");
    const emptyRow=await ctx.repos.requirements.get(manual.requirementId);
    assert.deepEqual(emptyRow?.audienceTags,[]);
    assert.equal(emptyRow?.audienceConfirmed,true);
    assert.equal(emptyRow?.audienceVersion,2);
    // 无副作用：不触发分析/推送作业，不改流水线状态
    assert.equal(await ctx.repos.jobs.findByDedupeKey(`analysis:${manual.requirementId}:v2`),null);
    assert.equal(emptyRow?.pipeline.analysis,"pending");
    assert.equal(emptyRow?.pipeline.push,"pending");
    // 审计记录修改者/前后版本
    const events=await ctx.repos.audit.search({entityId:manual.requirementId,limit:20});
    assert.equal(events.filter((event)=>event.eventType==="audience.updated").length,2);
  }finally{await cleanup(ctx);}
});

test("V02-T11 RICE draft: save, merge, optimistic conflict, history, no side effects",async()=>{
  const ctx=await setup();
  try{
    const manual=await ctx.repos.requirements.createManualRequirement({idempotencyKey:"rice-m-1",actorId:"a1",requestHash:"1".repeat(64),title:"Beta诉求",description:"描述",sourceChannel:"售后"});
    if(!("requirementId" in manual)) throw new Error("expected created outcome");
    assert.equal(await ctx.repos.requirements.getRiceDraft(manual.requirementId),null);
    // 首次保存（expected 0）：草稿 v1，记录来源版本
    const first=await ctx.repos.requirements.saveRiceDraft({requirementId:manual.requirementId,expectedEditVersion:0,actorId:"pm-1",sourceVersion:1,reachInput:"约200次/月",notes:"依据客服月报"});
    assert.deepEqual(first,{outcome:"saved",editVersion:1});
    const draft=await ctx.repos.requirements.getRiceDraft(manual.requirementId);
    assert.equal(draft?.reachInput,"约200次/月");
    assert.equal(draft?.sourceVersion,1);
    assert.equal(draft?.updatedBy,"pm-1");
    // 部分更新合并：未传字段保留
    const second=await ctx.repos.requirements.saveRiceDraft({requirementId:manual.requirementId,expectedEditVersion:1,actorId:"pm-2",sourceVersion:1,impactInput:"3"});
    assert.equal(second.outcome,"saved");
    const merged=await ctx.repos.requirements.getRiceDraft(manual.requirementId);
    assert.equal(merged?.reachInput,"约200次/月");
    assert.equal(merged?.impactInput,"3");
    assert.equal(merged?.editVersion,2);
    // 乐观冲突
    const stale=await ctx.repos.requirements.saveRiceDraft({requirementId:manual.requirementId,expectedEditVersion:0,actorId:"pm-1",sourceVersion:1,effortInput:"2"});
    assert.deepEqual(stale,{outcome:"version_conflict",currentEditVersion:2});
    // 历史：两版本快照可追溯
    const history=await ctx.pool.query("SELECT edit_version,snapshot->>'actor' AS a FROM rice_draft_history WHERE requirement_id=$1 ORDER BY edit_version",[manual.requirementId]);
    assert.equal(history.rows.length,2);
    // 零副作用：不入队、不改流水线
    const jobs=await ctx.pool.query("SELECT COUNT(*)::int AS n FROM pipeline_jobs WHERE payload->>'requirementId'=$1",[manual.requirementId]);
    assert.equal(Number(jobs.rows[0].n),1); // 仅建单时的首分析作业
    const row=await ctx.repos.requirements.get(manual.requirementId);
    assert.equal(row?.pipeline.analysis,"pending");
    assert.equal(row?.pipeline.push,"pending");
  }finally{await cleanup(ctx);}
});

test("V02-T13 Kano evidence: import, PII flag blocks approval, clean approve, immutable versions",async()=>{
  const ctx=await setup();
  try{
    // 含手机号/邮箱的材料：导入成功但被标记，批准拒绝（AC03）
    const flagged=await ctx.repos.requirements.createKanoEvidence({title:"含PII的访谈总结",summary:"用户 13800138000 反馈…邮箱 a@b.com",evidenceFragments:[{ref:"S1",text:"反馈人：张三"}],createdBy:"maintainer"});
    assert.equal(flagged.piiFlagged,true);
    assert.equal(flagged.status,"draft");
    assert.equal((await ctx.repos.requirements.approveKanoEvidence(flagged.id,"approver")).outcome,"pii_flagged");
    // 干净材料（安全合成样本）：导入→批准→可被模型输入引用
    const clean=await ctx.repos.requirements.createKanoEvidence({title:"骑行训练需求访谈（去标识化）",summary:"多名竞技与爱好者用户关注训练计划的准确性与完成度分析。",evidenceFragments:[{ref:"S1",text:"竞技用户重视训练完成度分析"},{ref:"S2",text:"爱好者关注数据可读性"}],coverageNotes:"L2/L3 在总结中合并，无法区分；L1 缺直接样本。",knownAudiences:["L2","L3"],createdBy:"maintainer"});
    assert.equal(clean.piiFlagged,false);
    assert.equal(clean.version,2);
    assert.deepEqual((await ctx.repos.requirements.approveKanoEvidence(clean.id,"approver")),{outcome:"approved"});
    const listed=await ctx.repos.requirements.listKanoEvidence();
    assert.equal(listed.length,2);
    const approvedRow=listed.find((v)=>v.id===clean.id);
    assert.equal(approvedRow?.status,"approved");
    // 版本不可变：更新=新版本（导入第三版），旧版内容不变（AC05）
    const third=await ctx.repos.requirements.createKanoEvidence({title:"更新后的总结",summary:"新增通勤场景线索。",evidenceFragments:[{ref:"S1",text:"通勤用户希望路况提醒"}],createdBy:"maintainer"});
    assert.equal(third.version,3);
    assert.equal((await ctx.repos.requirements.listKanoEvidence()).find((v)=>v.id===clean.id)?.summary,"多名竞技与爱好者用户关注训练计划的准确性与完成度分析。");
    // 未知批准目标
    assert.equal((await ctx.repos.requirements.approveKanoEvidence("00000000-0000-4000-8000-000000000000","a")).outcome,"not_found");
  }finally{await cleanup(ctx);}
});

test("V02-T14 Kano runs: versioned create with active guard, job+audit in txn, lifecycle states",async()=>{
  const ctx=await setup();
  try{
    const manual=await ctx.repos.requirements.createManualRequirement({idempotencyKey:"kano-m-1",actorId:"a1",requestHash:"1".repeat(64),title:"训练计划诉求",description:"竞技用户需要训练计划",sourceChannel:"运营/用研"});
    if(!("requirementId" in manual)) throw new Error("expected created outcome");
    const evidence=await ctx.repos.requirements.createKanoEvidence({title:"合成总结",summary:"竞技用户重视训练完成度分析。",evidenceFragments:[{ref:"S1",text:"竞技用户重视训练完成度分析"}],createdBy:"maintainer"});
    await ctx.repos.requirements.approveKanoEvidence(evidence.id,"approver");
    // 创建：v1 + kano_run 作业 + 审计，同事务
    const created=await ctx.repos.requirements.createKanoRun({requirementId:manual.requirementId,sourceVersion:1,audienceSnapshot:{tags:["L2"],confirmed:true},evidenceVersion:evidence.version,promptVersion:"rq-kano-v1",createdBy:"pm-1"});
    assert.equal(created.outcome,"created");
    assert.equal(created.run.runVersion,1);
    assert.equal(created.run.status,"running");
    const job=await ctx.repos.jobs.findByDedupeKey(`kano:${manual.requirementId}:rv1`);
    assert.equal(job?.jobType,"kano_run");
    // 活动运行守卫：running 期间拒绝再次创建（AC02）
    assert.equal((await ctx.repos.requirements.createKanoRun({requirementId:manual.requirementId,sourceVersion:1,audienceSnapshot:{tags:[],confirmed:false},evidenceVersion:evidence.version,promptVersion:"rq-kano-v1",createdBy:"pm-1"})).outcome,"active_run_exists");
    // 完成 → succeeded；显式重跑生成 v2
    const done=await ctx.repos.requirements.completeKanoRun(created.run.id,{capabilities:[],gaps:[],confidence:"中",confidenceReason:"r"},"stub");
    assert.equal(done?.status,"succeeded");
    const rerun=await ctx.repos.requirements.createKanoRun({requirementId:manual.requirementId,sourceVersion:1,audienceSnapshot:{tags:["L2"],confirmed:true},evidenceVersion:evidence.version,promptVersion:"rq-kano-v1",createdBy:"pm-1"});
    assert.equal(rerun.outcome,"created");
    assert.equal(rerun.run.runVersion,2);
    // 失败路径
    const failed=await ctx.repos.requirements.failKanoRun(rerun.run.id,"KANO_INVALID_OUTPUT","invalid");
    assert.equal(failed?.status,"failed");
    // 主流程隔离：需求流水线未动，kano 作业与主作业命名空间分离
    const row=await ctx.repos.requirements.get(manual.requirementId);
    assert.equal(row?.pipeline.analysis,"pending");
    assert.equal(row?.pipeline.push,"pending");
    const events=await ctx.repos.audit.search({entityId:manual.requirementId,limit:30});
    assert.equal(events.filter((event)=>event.eventType==="kano.run_requested").length,2);
  }finally{await cleanup(ctx);}
});

test("V02-S06 score versions: AI suggestion, manual confirmation and AI adoption keep one current version",async()=>{
  const ctx=await setup();
  try{
    const source=await ctx.repos.sources.create(config);
    const batch=await ctx.repos.batches.create({sourceConfigId:source.id,triggerType:"manual",actorId:null,idempotencyKey:"scoring-version-0001",startedAt:"2026-10-08T00:00:00Z"});
    const req=await ctx.repos.requirements.upsertRequirement(source.id,"task-score",requirementWrite(source.id,batch.id,{teambitionRequirementId:"task-score"}));
    const rule=await ctx.repos.priorityRules.getPublished();
    assert.ok(rule);
    const audit=(id:string)=>({id,actorId:"pm-1",eventType:"scoring.updated",entityType:"requirement",result:"succeeded" as const,safeDetails:{},occurredAt:"2026-10-08T00:00:00Z"});
    const base={requirementId:req.id,sourceVersion:1,analysisVersion:1,ruleVersionId:rule!.id,inputs:{user:{pain:3,frequency:4},market:{sellingPoint:1,competitor:1},strategy:{roadmap:1,dependency:1},cost:{workload:3,technicalRisk:2,resource:2}},alpha:0.8,score:6.4,priority:"P3" as const,scoreConfidence:"中",scoreConfidenceReason:"r",safetyFlag:false,basis:{},rationale:"r"};
    const first=await ctx.repos.scoring.createAi({...base,auditEvent:{...audit("00000000-0000-4000-8000-000000000201"),entityType:"requirement",eventType:"scoring.suggested"}});
    assert.equal(first.status,"current");
    const second=await ctx.repos.scoring.createAi({...base,inputs:{...base.inputs,user:{pain:4,frequency:5}},score:15.2,priority:"P2"});
    assert.equal(second.status,"ai_suggested");
    assert.equal((await ctx.repos.scoring.current(req.id))?.id,first.id);
    assert.equal((await ctx.repos.scoring.aiSuggestion(req.id))?.id,second.id);
    const manual=await ctx.repos.scoring.saveManual({...base,expectedVersion:1,score:10,priority:"P2",actorId:"pm-1",reason:"人工修正",auditEvent:{...audit("00000000-0000-4000-8000-000000000202"),eventType:"scoring.updated"}});
    assert.equal(manual.outcome,"saved");
    if(manual.outcome==="saved"){
      assert.equal(manual.version.status,"confirmed");
      assert.equal(manual.version.version,3);
      assert.equal((await ctx.repos.scoring.current(req.id))?.version,3);
      const applied=await ctx.repos.scoring.applyAi({requirementId:req.id,expectedVersion:3,aiVersion:2,actorId:"pm-1",reason:"采用AI",auditEvent:{...audit("00000000-0000-4000-8000-000000000203"),eventType:"scoring.ai_applied"}});
      assert.equal(applied.outcome,"saved");
      if(applied.outcome==="saved") assert.equal(applied.version.origin,"ai_applied");
    }
    const conflict=await ctx.repos.scoring.saveManual({...base,expectedVersion:1,score:10,priority:"P2",actorId:"pm-1",reason:"旧版本",auditEvent:audit("00000000-0000-4000-8000-000000000204")});
    assert.equal(conflict.outcome,"version_conflict");
    const history=await ctx.repos.scoring.list(req.id);
    assert.equal(history.filter((entry)=>entry.status==="confirmed"||entry.status==="current").length,1);
  }finally{await cleanup(ctx);}
});

test("V02-T10 seeded v1 rule remains historical; V02-S06 scoring v2 is the single published rule",async()=>{
  const ctx=await setup();
  try{
    const list=await ctx.repos.priorityRules.list();
    const historical=list.find((v)=>v.version===1);
    assert.ok(historical);
    assert.equal(historical.status,"retired");
    const v1=buildPriorityRule(historical)!;
    assert.equal(v1.compute({user:"高",market:"高",business:"高",technology:"高"}),"P0");
    assert.equal(v1.compute({user:"其它建议",market:"高",business:"高",technology:"高"}),null);
    const published=await ctx.repos.priorityRules.getPublished();
    assert.ok(published);
    assert.equal((published!.rules as Record<string,unknown>).formulaType,"umsc_weighted_v2");
    const v2=buildPriorityRule(published!)!;
    const computed=v2.computeScore!({user:{pain:4,frequency:5},market:{sellingPoint:2,competitor:2},strategy:{roadmap:1,dependency:1},cost:{workload:4,technicalRisk:4,resource:4}},0.8);
    assert.deepEqual(computed,{score:15.2,priority:"P2",breakdown:{user:20,market:4,strategy:1,cost:4,userAdjusted:16}});
    assert.equal(list.filter((v)=>v.status==="published").length,1);
  }finally{await cleanup(ctx);}
});
