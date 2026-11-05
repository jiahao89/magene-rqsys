import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createPool } from "./pool.js";

function withEnv<T>(key: string, value: string | undefined, run: () => T): T {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test("pool is disabled without a database url", () => {
  assert.equal(createPool(undefined), null);
  assert.equal(createPool(""), null);
});

test("pool size defaults to 10 and honours PG_POOL_MAX", async () => {
  const pools: Pool[] = [];
  const sizedFromEnv = (value: string | undefined): number => {
    let max = -1;
    withEnv("PG_POOL_MAX", value, () => {
      const pool = createPool("postgres://example/db");
      assert.ok(pool);
      pools.push(pool);
      max = pool.options.max ?? -1;
    });
    return max;
  };
  try {
    assert.equal(sizedFromEnv(undefined), 10);
    assert.equal(sizedFromEnv("6"), 6);
    assert.equal(sizedFromEnv("0"), 10);
    assert.equal(sizedFromEnv("abc"), 10);
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
  }
});
