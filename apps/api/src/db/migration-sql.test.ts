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
