import { Pool } from "pg";

export function createPool(databaseUrl: string | undefined): Pool | null {
  if (!databaseUrl) return null;
  return new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "rq-sys-api",
  });
}

