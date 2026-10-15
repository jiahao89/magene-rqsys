/** 固定合成数据及服务端验收隔离策略。不得接受用户需求文本。 */
const SAFE_BASE = {
  appToken: "OddqbqBeOamFjFsR5IXcJdjknmd",
  tableId: "tblxbyvbdLGVnLaO",
} as const;

export function canEnableTestFixtures(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RQSYS_ENABLE_TEST_FIXTURES === "true"
    && env.BASE_APP_TOKEN === SAFE_BASE.appToken
    && env.BASE_TABLE_ID === SAFE_BASE.tableId;
}

/** 设置了测试模式却不安全时拒绝执行，不能回落成真实同步。 */
export function readScheduledFixtureSource(env: NodeJS.ProcessEnv, now: Date): string | undefined {
  const raw = env.RQSYS_SCHEDULE_FIXTURE;
  if (!raw) return undefined;
  if (!canEnableTestFixtures(env)) throw new Error("Scheduled fixtures require the enabled isolated POC Base");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Invalid scheduled fixture configuration"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid scheduled fixture configuration");
  const mode = value as Record<string, unknown>;
  if (Object.keys(mode).some((key) => key !== "sourceId" && key !== "expiresAt")
    || typeof mode.sourceId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mode.sourceId)
    || typeof mode.expiresAt !== "string"
    || !/T.+(?:Z|[+-]\d{2}:\d{2})$/.test(mode.expiresAt)) {
    throw new Error("Invalid scheduled fixture configuration");
  }
  const remainingMs = Date.parse(mode.expiresAt) - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > 2 * 60 * 60 * 1000) {
    throw new Error("Scheduled fixture configuration is expired or exceeds two hours");
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
  if (work.fixture && !canEnableTestFixtures(env)) throw new Error("Fixture work requires the enabled isolated POC Base");
  if (scheduledSource && (!work.fixture || work.sourceId !== scheduledSource)) {
    throw new Error("Only the selected synthetic source may run during scheduled acceptance");
  }
}

export function isSyntheticFixtureRequirement(sourceRequirementId: string): boolean {
  return sourceRequirementId.startsWith("rqsys-fixture-");
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
