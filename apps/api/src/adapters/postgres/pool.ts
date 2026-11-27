import { Pool } from "pg";

const DEFAULT_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const DEFAULT_QUERY_TIMEOUT_MS = 20_000;

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createPool(databaseUrl: string | undefined): Pool | null {
  if (!databaseUrl) return null;
  // EQ-08：推送锁、需求 advisory lock 与 worker 心跳续约都会占用连接；默认 5 在并发请求下容易排队。
  // 可用 PG_POOL_MAX / PG_STATEMENT_TIMEOUT_MS / PG_QUERY_TIMEOUT_MS 调整，非法值回落到默认值。
  const max = parsePositiveIntEnv(process.env.PG_POOL_MAX, DEFAULT_POOL_MAX);
  const statement_timeout = parsePositiveIntEnv(process.env.PG_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS);
  const query_timeout = parsePositiveIntEnv(process.env.PG_QUERY_TIMEOUT_MS, DEFAULT_QUERY_TIMEOUT_MS);
  return new Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout,
    query_timeout,
    application_name: "rq-sys-api",
  });
}

