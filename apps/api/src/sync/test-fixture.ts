/** 固定合成数据及服务端验收隔离策略。不得接受用户需求文本。 */
const SAFE_BASE = {
  appToken: "OddqbqBeOamFjFsR5IXcJdjknmd",
  tableId: "tblxbyvbdLGVnLaO",
} as const;

export type FixturePolicyReason = "fixture_flag_disabled" | "base_app_not_poc" | "base_table_not_poc" | "invalid_config" | "expired_config" | "source_mismatch" | "mixed_identities" | "unspecified";

export class FixturePolicyError extends Error {
  constructor(message: string, readonly reason: FixturePolicyReason = "unspecified") { super(message); this.name = "FixturePolicyError"; }
}

function fixturePolicyFailureReason(env: NodeJS.ProcessEnv): FixturePolicyReason | undefined {
  if (env.RQSYS_ENABLE_TEST_FIXTURES !== "true") return "fixture_flag_disabled";
  if (env.BASE_APP_TOKEN !== SAFE_BASE.appToken) return "base_app_not_poc";
  if (env.BASE_TABLE_ID !== SAFE_BASE.tableId) return "base_table_not_poc";
  return undefined;
}

export function canEnableTestFixtures(env: NodeJS.ProcessEnv = process.env): boolean {
  return fixturePolicyFailureReason(env) === undefined;
}

/** 设置了测试模式却不安全时拒绝执行，不能回落成真实同步。 */
export function readScheduledFixtureSource(env: NodeJS.ProcessEnv, now: Date): string | undefined {
  const raw = env.RQSYS_SCHEDULE_FIXTURE;
  if (!raw) return undefined;
  const policyFailure = fixturePolicyFailureReason(env);
  if (policyFailure) throw new FixturePolicyError("Scheduled fixtures require the enabled isolated POC Base", policyFailure);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new FixturePolicyError("Invalid scheduled fixture configuration", "invalid_config"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FixturePolicyError("Invalid scheduled fixture configuration", "invalid_config");
  const mode = value as Record<string, unknown>;
  if (Object.keys(mode).some((key) => key !== "sourceId" && key !== "expiresAt")
    || typeof mode.sourceId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mode.sourceId)
    || typeof mode.expiresAt !== "string"
    || !/T.+(?:Z|[+-]\d{2}:\d{2})$/.test(mode.expiresAt)) {
    throw new FixturePolicyError("Invalid scheduled fixture configuration", "invalid_config");
  }
  const remainingMs = Date.parse(mode.expiresAt) - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > 2 * 60 * 60 * 1000) {
    throw new FixturePolicyError("Scheduled fixture configuration is expired or exceeds two hours", "expired_config");
  }
  return mode.sourceId;
}

/** 在每个外部调用前使用；退出模式后延迟夹具也不能写入正式 Base。 */
export function assertFixtureWorkAllowed(
  work: { sourceId: string; fixture: boolean },
  env: NodeJS.ProcessEnv,
  now: Date,
): void {
  const scheduledSource = readScheduledFixtureSource(env, now);
  const policyFailure = fixturePolicyFailureReason(env);
  if (work.fixture && policyFailure) throw new FixturePolicyError("Fixture work requires the enabled isolated POC Base", policyFailure);
  if (scheduledSource && (!work.fixture || work.sourceId !== scheduledSource)) {
    throw new FixturePolicyError("Only the selected synthetic source may run during scheduled acceptance", "source_mismatch");
  }
}

export function isSyntheticFixtureRequirement(sourceRequirementId: string | null): boolean {
  // 手工需求没有 TB ID（null）：不是合成夹具，正常放行（V02-T02 起可空）。
  return sourceRequirementId !== null && sourceRequirementId.startsWith("rqsys-fixture-");
}

/** 兼容旧的单项重试队列：身份以持久化条目 ID 为准，不只依赖 marker。 */
export function isSyntheticFixtureSyncJob(job: { testFixture?: boolean; onlyIds?: readonly string[] }): boolean {
  const ids = job.onlyIds ?? [];
  const hasFixtureId = ids.some(isSyntheticFixtureRequirement);
  if ((hasFixtureId || job.testFixture) && ids.some((id) => !isSyntheticFixtureRequirement(id))) {
    throw new FixturePolicyError("Synthetic and real source identities cannot be mixed", "mixed_identities");
  }
  return job.testFixture === true || hasFixtureId;
}

export function createSyntheticFixtureTask(batchId: string, requirementTypeId: string) {
  return {
    id: `rqsys-fixture-${batchId}`,
    content: "【RQ-Sys安全测试】模拟需求：验证同步、AI 建议与 Base 推送。",
    created: "2026-01-01T00:00:00.000Z",
    executor_id: null,
    creator_id: null,
    taskflow_status_id: null,
    scenariofield_config_id: requirementTypeId,
    custom_fields: [],
  };
}

export function createSyntheticFixtureTasks(batchId: string, requirementTypeId: string, onlyIds?: readonly string[]) {
  if (onlyIds?.some((id) => !isSyntheticFixtureRequirement(id))) throw new FixturePolicyError("Fixture retries require synthetic identities", "mixed_identities");
  const ids = onlyIds ?? [`rqsys-fixture-${batchId}`];
  return ids.map((id) => ({ ...createSyntheticFixtureTask(batchId, requirementTypeId), id }));
}
