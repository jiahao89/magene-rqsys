import assert from "node:assert/strict";
import test from "node:test";
import { stripTransactionWrapper } from "./migration-sql.js";

test("剥离文件自带的顶层 BEGIN;/COMMIT;", () => {
  const { sql, stripped } = stripTransactionWrapper("BEGIN;\nCREATE TABLE t (id int);\nCOMMIT;\n");
  assert.equal(stripped, true);
  assert.match(sql, /CREATE TABLE t/);
  assert.equal(/^\s*BEGIN/i.test(sql), false);
  assert.equal(/COMMIT\s*;\s*$/i.test(sql), false);
});

test("没有事务包装的文件原样返回", () => {
  const input = "CREATE TABLE t (id int);\nINSERT INTO t VALUES (1);\n";
  const { sql, stripped } = stripTransactionWrapper(input);
  assert.equal(stripped, false);
  assert.equal(sql, input);
});

test("只剥离首尾：PL/pgSQL 的 BEGIN 与文件中间的 COMMIT 不受影响", () => {
  const input = [
    "BEGIN;",
    "DO $$ BEGIN",
    "  IF NOT EXISTS (SELECT 1 FROM t) THEN INSERT INTO t VALUES (1); END IF;",
    "END $$;",
    "COMMIT;",
  ].join("\n");
  const { sql } = stripTransactionWrapper(input);
  assert.match(sql, /DO \$\$ BEGIN/); // 块内 BEGIN 保留
  assert.match(sql, /END \$\$;/);
  assert.equal(sql.includes("COMMIT;"), false);
});

test("大小写与空白不敏感", () => {
  const { stripped } = stripTransactionWrapper("\n\n  begin ;\nSELECT 1;\n  commit ;  \n");
  assert.equal(stripped, true);
});

test("常见迁移：BEGIN 与 COMMIT 都在时，中间语句完整保留", () => {
  const { sql } = stripTransactionWrapper("BEGIN;\nA;\nB;\nCOMMIT;");
  assert.match(sql, /A;/);
  assert.match(sql, /B;/);
});

test("注释开头的迁移也能剥离：0008 起的迁移都是先写注释再写 BEGIN;", () => {
  // 旧正则只认文件首个非空白字符，导致 18 个带包装的迁移只剥掉 6 个，
  // 文件自带的 COMMIT 会提前提交 runner 的事务。
  const input = [
    "-- 0008: 修正花名册与模块词典中的姓名错字",
    "-- 第二条注释",
    "",
    "BEGIN;",
    "UPDATE t SET name = 'x' WHERE name = 'y';",
    "COMMIT;",
    "",
  ].join("\n");
  const { sql, stripped } = stripTransactionWrapper(input);
  assert.equal(stripped, true);
  assert.match(sql, /^-- 0008/, "注释保留");
  assert.match(sql, /UPDATE t SET name/);
  assert.equal(/COMMIT\s*;\s*$/.test(sql), false);
});

test("仓库内每个带事务包装的迁移都能被剥离", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = resolve(fileURLToPath(import.meta.url), "../../../../../database/migrations");
  const missed: string[] = [];
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".sql"))) {
    const sql = await readFile(resolve(dir, name), "utf8");
    const wrapped = /^\s*BEGIN\s*;/im.test(sql) && /COMMIT\s*;\s*$/i.test(sql.trim());
    if (wrapped && !stripTransactionWrapper(sql).stripped) missed.push(name);
  }
  assert.deepEqual(missed, [], "带 BEGIN;/COMMIT; 的迁移必须全部被剥离，否则内层 COMMIT 会提前提交外层事务");
});
