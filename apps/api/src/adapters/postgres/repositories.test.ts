import test from "node:test";
import assert from "node:assert/strict";
import { PostgresRepositories } from "./repositories.js";

function recordingPool() {
  const calls: Array<{sql:string;values:unknown[]|undefined}> = [];
  const resultFor = (sql:string) => sql.includes("source_configs")
    ? { rows: [{ id:"sid",provider:"teambition",external_project_id:"p",external_project_name:"P",requirement_type_id:"t",enabled:false,schedule_enabled:false,schedule_weekday:null,schedule_local_time:null,schedule_timezone:null,owner_names:[],field_map:{},created_at:new Date(0),updated_at:new Date(0)}], rowCount:1 }
    : { rows: [], rowCount:0 };
  const pool = { query: async (sql:string,values?:unknown[]) => { calls.push({sql,values}); return resultFor(sql); }, connect: async () => ({ query: async (sql:string,values?:unknown[]) => { calls.push({sql,values}); return resultFor(sql); }, release(){} }) };
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

test("job claim uses SKIP LOCKED and expires old leases", async()=>{
  const {pool,calls}=recordingPool();const store=new PostgresRepositories(pool);
  await store.jobs.claimNext("worker-1",30000,"2026-01-01T00:00:00Z");
  assert.match(calls[0]!.sql,/^BEGIN$/);assert.match(calls[1]!.sql,/FOR UPDATE SKIP LOCKED/);assert.match(calls[1]!.sql,/locked_until <= \$1/);
});
