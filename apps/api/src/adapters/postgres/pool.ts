import { Pool } from "pg";

export function createPool(databaseUrl: string | undefined): Pool | null {
  if (!databaseUrl) return null;
  // EQ-08：推送锁、需求 advisory lock 与 worker 心跳续约都会占用连接；默认 5 在并发请求下容易排队。
  // 可用 PG_POOL_MAX 调整，非法值回落到默认值。
  const configuredMax = Number(process.env.PG_POOL_MAX ?? 10);
  const max = Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : 10;
  return new Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "rq-sys-api",
  });
}

