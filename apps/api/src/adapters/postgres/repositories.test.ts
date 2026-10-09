import test from "node:test";
import assert from "node:assert/strict";
import { PostgresRepositories } from "./repositories.js";

function recordingPool() {
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  const resultFor = (sql:string, values?:unknown[]) => sql.includes("source_configs")
    ? { rows: [{ id:"sid",provider:"teambition",external_project_id:"p",external_project_name:"P",requirement_type_id:"t",enabled:false,schedule_enabled:false,schedule_weekday:null,schedule_local_time:null,schedule_timezone:null,owner_names:[],field_map:{},created_at:new Date(0),updated_at:new Date(0)}], rowCount:1 }
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

test("audit search uses parameterized filters and limit", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.audit.search({entityId:"e1",since:"2026-01-01T00:00:00Z",limit:10});
  assert.match(calls[0]!.sql,/WHERE \(\$1::text IS NULL/);assert.deepEqual(calls[0]!.values,["e1","2026-01-01T00:00:00Z",null,10]);
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
