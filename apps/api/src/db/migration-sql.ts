// 迁移文件的顶层事务包装剥离。
//
// 执行器（db/migrate.ts）已经为每个文件开启事务，并把 schema_migrations 的写入
// 放在同一个事务里。若文件自身再写一层 BEGIN;/COMMIT;，内层 COMMIT 会提前提交外层
// 事务：之后的 INSERT 落在事务外，失败时 ROLLBACK 变成空操作，迁移留下半应用状态。
//
// 0003_team_directory_seed.sql 是唯一这样写的迁移。已应用的迁移文件名与内容都不能改写，
// 因此在执行器侧规范化。
//
// 只剥离「语句级、位于文件首尾」的 BEGIN;/COMMIT;。PL/pgSQL 的 BEGIN（位于 DO $$ ... $$ 内、
// 后面不跟分号）与文件中间的语句都不会被误伤。

const LEADING_BEGIN = /^\s*BEGIN\s*;\s*/i;
const TRAILING_COMMIT = /\s*COMMIT\s*;\s*$/i;

export function stripTransactionWrapper(sql: string): { sql: string; stripped: boolean } {
  const withoutBegin = sql.replace(LEADING_BEGIN, "");
  if (withoutBegin === sql) return { sql, stripped: false };
  const withoutCommit = withoutBegin.replace(TRAILING_COMMIT, "\n");
  return { sql: withoutCommit, stripped: true };
}
