// 应用期望已应用的最新迁移文件。新增迁移时必须同步更新这里（check-migrations 会校验），
// 用于健康检查/运维页提示「代码与库结构是否一致」，避免开发库或目标库悄悄落后。
export const EXPECTED_LATEST_MIGRATION = "0028_system_flags.sql";
