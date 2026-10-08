import type { Pool } from "pg";

export async function isDatabaseReady(pool: Pool | null): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

