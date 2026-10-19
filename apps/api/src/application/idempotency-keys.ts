// root 历史 import 路径的兼容出口。实现收敛在 jobs/idempotency.ts，
// 与妙搭仓保持同一份 base_push 幂等键格式，避免两个仓库/两处定义漂移。
export { basePushIdempotencyKey } from "../jobs/idempotency.js";
