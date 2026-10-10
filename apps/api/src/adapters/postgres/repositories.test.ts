import test from "node:test";
import assert from "node:assert/strict";
import { PostgresRepositories } from "./repositories.js";

function recordingPool() {
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  const resultFor = (sql:string, values?:unknown[]) => sql.includes("source_configs")
    ? { rows: [{ id:"sid",provider:"teambition",external_project_id:"p",external_project_name:"P",requirement_type_id:"t",enabled:false,schedule_enabled:false,schedule_weekday:null,schedule_local_time:null,schedule_timezone:null,owner_names:[],field_map:{},created_at:new Date(0),updated_at:new Date(0)}], rowCount:1 }
    : sql.includes("pipeline_jobs")
      ? { rows: [{ id:"job-1",job_type:"analysis",dedupe_key:values?.[2],payload:{requirementId:"req-1"},status:"queued",attempt_count:0,max_attempts:5,available_at:new Date(0),locked_until:null,last_error_code:null,last_error_summary:null,created_at:new Date(0),updated_at:new Date(0)}], rowCount:1 }
    : sql.includes("base_push_runs") && sql.includes("idempotency_key")
      ? { rows: [{ id:"push-1",requirement_id:"req-1",source_version:2,push_version:3,status:"pushed",idempotency_key:values?.[0],base_record_id:"base-1",safe_error_code:null,safe_error_summary:null,started_at:new Date(0),completed_at:new Date(1)}], rowCount:1 }
      : { rows: [], rowCount:0 };
  const pool = { query: async (sql:string,values?:unknown[]) => { calls.push({sql,values}); return resultFor(sql,values); }, connect: async () => ({ query: async (sql:string,values?:unknown[]) => { calls.push({sql,values}); return resultFor(sql,values); }, release(){} }) };
  return { pool: pool as never, calls };
}

test("source config repository maps persisted snake_case fields", async()=>{
  const {pool}=recordingPool();const store=new PostgresRepositories(pool);const rows=await store.sources.list();
  assert.equal(rows[0]?.externalProjectId,"p");assert.equal(rows[0]?.scheduleTimezone,null);
});

test("source config JSON fields are passed as JSON, not PostgreSQL array literals", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.sources.create({projectId:"p",projectName:"P",requirementTypeId:"t",enabled:true,schedule:{enabled:false,weekday:null,time:null,timezone:null},ownerNames:["PM Owner"],fieldMap:{description:"cf-1"}});
  const insert=calls.find((call)=>call.sql.includes("INSERT INTO source_configs"));
  assert.equal(insert?.values?.[9],JSON.stringify(["PM Owner"]));
  assert.equal(insert?.values?.[10],JSON.stringify({description:"cf-1"}));
});

test("audit search uses parameterized filters and limit", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.audit.search({entityId:"e1",since:"2026-01-01T00:00:00Z",limit:10});
  assert.match(calls[0]!.sql,/WHERE \(\$1::text IS NULL/);assert.deepEqual(calls[0]!.values,["e1","2026-01-01T00:00:00Z",null,10]);
});

test("audit persistence strips fields outside the safe details allowlist", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.audit.append({id:"00000000-0000-4000-8000-000000000123",actorId:"actor-1",eventType:"source.updated",entityType:"source_config",entityId:"source-1",result:"succeeded",safeDetails:{sourceVersion:2,apiKey:"secret",unreviewedField:"private"},occurredAt:"2026-10-10T00:00:00Z"});
  const insert=calls.find((call)=>call.sql.includes("INSERT INTO audit_events"));
  assert.deepEqual(insert?.values?.[6],{sourceVersion:2});
});

test("batch search applies inclusive time bounds and a stable composite cursor", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  const cursor={startedAt:"2026-01-02T00:00:00.000Z",id:"33333333-3333-4333-8333-333333333333"};
  await store.batches.list({status:"failed",since:"2026-01-01T00:00:00Z",until:"2026-01-03T00:00:00Z",cursor,limit:10});
  assert.match(calls[0]!.sql,/started_at >= \$2/);assert.match(calls[0]!.sql,/started_at <= \$3/);assert.match(calls[0]!.sql,/\(started_at,id\)<\(\$4::timestamptz,\$5::uuid\)/);
  assert.deepEqual(calls[0]!.values,["failed","2026-01-01T00:00:00Z","2026-01-03T00:00:00Z",cursor.startedAt,cursor.id,11]);
});

test("requirement search filters by latest batch and last-seen time on the server", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.requirements.search({batchId:"33333333-3333-4333-8333-333333333333",since:"2026-01-01T00:00:00Z",until:"2026-01-02T00:00:00Z",limit:25});
  assert.match(calls[0]!.sql,/latest_batch_id=\$6/);assert.match(calls[0]!.sql,/last_seen_at >= \$7/);assert.match(calls[0]!.sql,/last_seen_at <= \$8/);
  assert.deepEqual(calls[0]!.values,[null,null,null,null,null,"33333333-3333-4333-8333-333333333333","2026-01-01T00:00:00Z","2026-01-02T00:00:00Z",null,null,26]);
});

test("base push repository looks up a run by idempotency key", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  const run=await store.basePushes.findByIdempotencyKey("push:key");
  assert.equal(run?.id,"push-1");assert.equal(run?.requirementId,"req-1");assert.equal(run?.baseRecordId,"base-1");
  assert.match(calls[0]!.sql,/FROM base_push_runs WHERE idempotency_key=\$1/);assert.deepEqual(calls[0]!.values,["push:key"]);
});

test("job claim uses SKIP LOCKED and expires old leases", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.jobs.claimNext("worker-1",30000,"2026-01-01T00:00:00Z");
  assert.match(calls[0]!.sql,/^BEGIN$/);assert.match(calls[1]!.sql,/FOR UPDATE SKIP LOCKED/);assert.match(calls[1]!.sql,/locked_until <= \$1/);
});

test("enqueue reopens a terminally failed job for an explicit same-key retry", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.jobs.enqueue({jobType:"analysis",dedupeKey:"analysis:req-1:sv1:after1",payload:{requirementId:"req-1"},availableAt:"2026-01-01T00:00:00Z"});
  assert.match(calls[0]!.sql,/ON CONFLICT\(dedupe_key\) DO UPDATE/);
  assert.match(calls[0]!.sql,/status IN \('failed','cancelled'\)/);
  assert.match(calls[0]!.sql,/attempt_count=0/);
});
