// 迁移文件的顶层事务包装剥离。
//
// 执行器（db/migrate.ts）已经为每个文件开启事务，并把 schema_migrations 的写入
// 放在同一个事务里。若文件自身再写一层 BEGIN;/COMMIT;，内层 COMMIT 会提前提交外层
// 事务：之后的 INSERT 落在事务外，失败时 ROLLBACK 变成空操作，迁移留下半应用状态。
//
// 多数迁移（0003–0019、0021）都这样写。已应用的迁移文件名与内容都不能改写，
// 因此在执行器侧规范化。
//
// 只剥离「语句级、位于文件首尾」的 BEGIN;/COMMIT;。PL/pgSQL 的 BEGIN（位于 DO $$ ... $$ 内、
// 后面不跟分号）与文件中间的语句都不会被误伤。
//
// BEGIN 前面允许有注释行：0008 起的迁移都以注释开头再写 BEGIN;，旧正则只认文件首个非空白字符，
// 结果 18 个带包装的迁移只剥掉了 6 个，文件自带的 COMMIT 仍然会提前提交 runner 的事务。

/** 开头允许的注释：整行 -- 注释与空行。块注释原样保留，不参与剥离判断。 */
const LEADING_COMMENTS = /^(?:[ \t]*(?:--[^\n]*)?\r?\n)*/;
const LEADING_BEGIN = /^\s*BEGIN\s*;\s*/i;
const TRAILING_COMMIT = /\s*COMMIT\s*;\s*$/i;

export function stripTransactionWrapper(sql: string): { sql: string; stripped: boolean } {
  // 注释与空行既不算语句，也不该阻止识别文件首个语句是不是 BEGIN;。
  const prefix = sql.match(LEADING_COMMENTS)?.[0] ?? "";
  const rest = sql.slice(prefix.length);
  const withoutBegin = rest.replace(LEADING_BEGIN, "");
  if (withoutBegin === rest) return { sql, stripped: false };
  const withoutCommit = prefix + withoutBegin.replace(TRAILING_COMMIT, "\n");
  return { sql: withoutCommit, stripped: true };
}
