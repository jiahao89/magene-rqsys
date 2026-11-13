# RQ-Sys 备份与恢复 Runbook（I3-6 / PR-12）

> 适用范围：妙搭目标环境未提供数据库快照，或需要把应用数据导出到受控存储时。
> 脚本：`scripts/rqsys-backup.mjs`（导出/校验）、`scripts/rqsys-restore.mjs`（隔离 schema 恢复演练）。
> 安全边界：快照包含需求标题/描述等业务数据，按数据治理要求加密保存，**不得提交仓库**。

## 1. 目标

| 指标 | 目标 | 说明 |
|---|---|---|
| RPO | ≤ 24 小时 | 每日导出一次；重大操作前额外导出 |
| RTO | ≤ 2 小时 | 300 条量级导出/恢复 < 5 分钟，主要耗时在平台发布与切换 |
| 恢复验证 | 每次备份可校验 | `verify` 通过（行数 + SHA-256） |
| 演练频率 | 上线前 1 次，之后每季度 1 次 | 记录在本文件 §6 |

## 2. 备份（在有平台凭据的机器执行）

```bash
# 目标环境（lark-cli 通道；RQSYS_APP_ID / RQSYS_ENV 由环境提供）
node scripts/rqsys-backup.mjs export --out backups/rq-sys-$(date +%Y%m%d)

# 本地/dev 直连
node scripts/rqsys-backup.mjs export \
  --database-url "$DATABASE_URL" --out /tmp/rq-backup

# 需要完整审计留痕时（量大）
node scripts/rqsys-backup.mjs export --include-audit --out backups/rq-sys-audit-$(date +%Y%m%d)
```

产物：每表一个 `*.jsonl` + `manifest.json`（生成时间、来源、行数、SHA-256、最新迁移）。

保存要求：

- 目录权限 `700`，传输/存储加密（平台对象存储加密桶或加密压缩包）；
- 保留 30 天；每月至少抽 1 份做 `verify`；
- 不放入 Git、不通过聊天工具传输。

校验：

```bash
node scripts/rqsys-backup.mjs verify --in backups/rq-sys-20261112
```

## 3. 恢复演练（隔离 schema，不碰生产）

演练目的地必须是**独立数据库或独立 schema**；脚本只接受 `rq_restore_*` schema，拒绝 `public`。

```bash
# 1) 准备一个隔离库（示例：本地 PostgreSQL）
createdb rq_restore_target

# 2) 执行迁移 + 恢复（脚本会建 schema、跑全部迁移、清空种子表后导入快照）
node scripts/rqsys-restore.mjs \
  --in backups/rq-sys-20261112 \
  --database-url postgres://user:pass@localhost:5432/rq_restore_target \
  --schema rq_restore_drill

# 3) 核对完成后清理
psql postgres://user:pass@localhost:5432/rq_restore_target -c 'DROP SCHEMA "rq_restore_drill" CASCADE;'
```

预期输出（2026-11-13 本地演练，dev 库快照）：

```
applied 28 migrations into rq_restore_drill
restored requirements: 284/284
restored sync_items: 1704/1704
...
rows: 2315 restored; requirements summary {"requirements":284,...}
all table row counts match the snapshot manifest
```

## 4. 恢复验证清单

- [ ] `verify` 通过（行数 + SHA-256）
- [ ] 恢复报告 `all table row counts match the snapshot manifest`
- [ ] 演练库抽查：`select count(*), count(*) filter (where processing_state<>'active') from requirements;`
- [ ] 关键记录抽查 3 条：标题、负责人、Base 记录 ID、当前优先级与快照原文一致
- [ ] `schema_migrations` 最新文件名与 `manifest.migrations` 一致（演练库由脚本执行迁移，不写记录；生产以正式迁移流程为准）
- [ ] 记录演练耗时（RTO 证据）

## 5. 生产恢复（谨慎）

1. 优先使用妙搭平台快照/回滚能力（若可用）。
2. 应用级快照**不直接覆盖生产**：先在隔离环境完成 §3/§4，再由有权限的管理员按平台流程导入。
3. 恢复窗口内暂停定时同步与分析（停用 automation 或置空 `WORKER_POLL_MS`），避免恢复期间产生新写入。
4. 恢复后执行一次全量同步与单条真实需求推送，确认主链路。

## 6. 演练记录

| 日期 | 快照时间 | 行数 | 演练库 | 耗时 | 结果 | 执行人 |
|---|---|---|---|---|---|---|
| 2026-11-13 | dev 库 0028 | 2315 | 本地临时 PostgreSQL / `rq_restore_drill` | 0.4s 恢复（迁移+导入） | 通过（21 表行数全部一致） | 开发 |
| | | | | | | |

## 7. 已知限制

- `lark-cli` 单次返回有大小限制：脚本按 200 行分页，超大数据集需关注总耗时与内存。
- 无 DDL 权限的平台环境不能创建演练 schema，需使用独立库或平台提供的恢复环境。
- 审计表默认不导出；合规要求完整留痕时使用 `--include-audit` 并单独保存。
- 快照不包含迁移记录写入；演练库的 `schema_migrations` 由正式迁移流程维护。
- 本方案不替代平台级备份；平台能力可用时优先使用平台方案。
