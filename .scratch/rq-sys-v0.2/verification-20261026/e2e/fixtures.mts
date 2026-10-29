// 本地 V0.2 功能验证夹具（仅验证脚本，不进产品代码/构建）。
// 组合方式与 Spec V02-S00「已确认的测试接缝」一致：真实 PostgreSQL 仓储 + 真实 HTTP 入口 +
// 真实 worker；外部 AI/Base 用受控实现替换，验证最终需求/快照/状态/Base 投影/通知事件。
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresRepositories } from "../../../../apps/api/src/adapters/postgres/repositories.js";
import { createPostgresSyncPersistence } from "../../../../apps/api/src/adapters/postgres/sync-persistence.js";
import { handleApiRequest, type ApiDependencies } from "../../../../apps/api/src/http/app.js";
import { createRequirementWorkflow, type RequirementWorkflow } from "../../../../apps/api/src/requirements/processing.js";
import { PipelineJobWorker } from "../../../../apps/api/src/jobs/worker.js";
import { SyncOrchestrator, type SyncSourceReader } from "../../../../apps/api/src/sync/service.js";
import { FeishuBasePushAdapter, type BaseClient, type BaseFieldMap, type BaseRecord, type BaseRequirementKey, type BaseWriteOptions } from "../../../../apps/api/src/base/client.js";
import { RateLimitedBaseClient } from "../../../../apps/api/src/base/rate-limit.js";
import { buildAnalysisRequest, validateAnalysisOutput, type ValidatedAnalysis } from "../../../../apps/api/src/analysis/contract.js";
import type { AiProvider, ProviderAnalysisInput } from "../../../../apps/api/src/analysis/provider.js";
import type { KanoProvider } from "../../../../apps/api/src/beta/kano.js";
import type { SourceProjectConfig } from "../../../../apps/api/src/domain/workflow.js";
import type { PipelineJobRecord } from "../../../../apps/api/src/domain/persistence.js";

export const VERIFY_ACTOR = "verify-operator";
export const PM_LEADER_USER_ID = "0123456789abcdef0123456789abcdef";
process.env.RQSYS_PM_LEADER_USER_ID = PM_LEADER_USER_ID;

export const BASE_FIELDS: BaseFieldMap = {
  requirementId: "TB需求ID",
  platformRequirementId: "需求平台ID",
  owner: "执行人",
  source: { title: "标题", description: "需求说明", createdAt: "TB创建时间", sourceUrl: "TB地址" },
  ai: { module: "AI模块建议", priority: "AI优先级建议", analysisVersion: "AI分析版本" },
  pm: ["PM状态", "PM确认模块", "PM确认优先级", "处理人", "处理时间", "结构化备注"],
  metadata: { sourceVersion: "源版本", pushState: "推送状态", lastPushedAt: "最后推送时间" },
  notification: {
    eventId: "系统通知事件ID",
    eventType: "系统通知类型",
    recipient: "系统通知收件人",
    ownerMergeValue: "系统负责人通知归并值",
    requirementLink: "系统需求链接",
  },
  selectOptions: { module: ["爬坡", "赛段", "训练-骑行台训练", "需求澄清"], priority: ["P0", "P1", "P2", "P3"] },
};

/** 受控 Base 传输替身：真实适配器在其上运行，验证字段映射/平台键/PM 快照/通知字段。 */
export class FakeBaseClient implements BaseClient {
  readonly rows = new Map<string, BaseRecord>();
  private readonly byPlatform = new Map<string, string>();
  private readonly byTb = new Map<string, string>();
  private next = 1;
  /** 读取 PM 字段时模拟一次 Base 读取失败（T07-AC05 PM 快照失败路径）。 */
  readPmFails = false;
  /** 每个 Base 行当前 PM 字段（模拟 PM 直接在 Base 中处理后的值）。 */
  readonly pm = new Map<string, Record<string, unknown>>();

  private index(record: BaseRecord) {
    const platform = record.fields["需求平台ID"];
    if (typeof platform === "string" && platform.trim()) this.byPlatform.set(platform, record.recordId);
    const tb = record.fields["TB需求ID"];
    if (typeof tb === "string" && tb.trim()) this.byTb.set(tb, record.recordId);
  }

  async readFieldType(): Promise<number> { return 1; }

  async findByPlatformKey(platformRequirementId: string): Promise<BaseRecord | null> {
    const id = this.byPlatform.get(platformRequirementId);
    return id ? this.rows.get(id) ?? null : null;
  }

  async findByRequirementKey(key: BaseRequirementKey): Promise<BaseRecord | null> {
    const id = this.byTb.get(key.requirementId);
    return id ? this.rows.get(id) ?? null : null;
  }

  async create(fields: Record<string, unknown>, _options?: BaseWriteOptions): Promise<BaseRecord> {
    const record: BaseRecord = { recordId: `rec_${String(this.next++).padStart(4, "0")}`, fields: structuredClone(fields) };
    this.rows.set(record.recordId, record);
    this.index(record);
    return structuredClone(record);
  }

  async update(recordId: string, fields: Record<string, unknown>, _options?: BaseWriteOptions): Promise<BaseRecord> {
    const existing = this.rows.get(recordId);
    if (!existing) throw new Error(`Base record not found: ${recordId}`);
    const merged = { ...existing.fields, ...structuredClone(fields) };
    const record: BaseRecord = { recordId, fields: merged };
    this.rows.set(recordId, record);
    this.index(record);
    return structuredClone(record);
  }

  async readPmFields(recordId: string): Promise<Record<string, unknown>> {
    if (this.readPmFails) throw new Error("simulated Base PM read failure");
    const row = this.rows.get(recordId);
    if (!row) throw new Error(`Base record not found: ${recordId}`);
    const pmFields: Record<string, unknown> = {};
    for (const field of BASE_FIELDS.pm) if (field in row.fields) pmFields[field] = row.fields[field];
    return { ...pmFields, ...(this.pm.get(recordId) ?? {}) };
  }

  /** 模拟 PM 直接在 Base 中编辑字段（写回行字段，供后续推送读取快照/保留值）。 */
  setPm(recordId: string, values: Record<string, unknown>): void {
    const row = this.rows.get(recordId);
    if (row) row.fields = { ...row.fields, ...structuredClone(values) };
    this.pm.set(recordId, { ...(this.pm.get(recordId) ?? {}), ...structuredClone(values) });
  }
}

export interface FakeAnalysisCall { input: ProviderAnalysisInput; masked: ReturnType<typeof buildAnalysisRequest>; }

/** 受控分析 provider：走真实契约校验（证据必须来自源文），产出确定性 U/M/S/C 与人群建议。 */
export class FakeAnalysisProvider implements AiProvider {
  readonly name = "controlled-provider";
  readonly model = "controlled-model-v1";
  readonly promptVersion = "rq-analysis-v3";
  readonly calls: FakeAnalysisCall[] = [];

  async analyze(input: ProviderAnalysisInput): Promise<ValidatedAnalysis> {
    try {
    const masked = buildAnalysisRequest(input);
    this.calls.push({ input, masked });
    const sourceText = [masked.title, masked.description, masked.context].join("\n");
    const quote = masked.title;
    const result = {
      module: input.dictionary.modules.includes("爬坡") ? "爬坡" : input.dictionary.modules[0] ?? "无法识别",
      confidence: "中",
      confidence_reason: "合成验收：需求正文与场景描述一致，覆盖基础判断。",
      evidence: [quote],
      recommendations: {
        user: { recommendation: "高", rationale: "直接影响用户导航体验。", evidence: [quote] },
        market: { recommendation: "中", rationale: "竞品同类能力较常见。", evidence: [quote] },
        business: { recommendation: "低", rationale: "不直接产生商业动作。", evidence: [quote] },
        technology: { recommendation: "无法判断", rationale: "缺少实现约束信息。", evidence: [quote], missing_evidence: true },
      },
      facts: [{ text: quote, evidence: quote }],
      inferences: [{ text: "用户可能偏好更稳定的路线提示。", ai_inference: true as const }],
      missing_inputs: ["未提供目标版本"],
      blind_spots: ["未覆盖不同地区地图数据"],
      priority: null,
      typeSuggestion: "体验优化",
      audience: [
        { level: "L2" as const, reason: "竞技训练场景直接相关。", evidence: [quote] },
        { level: "L3" as const, reason: "爱好者进阶场景相关。", evidence: [quote] },
      ],
    };
    return validateAnalysisOutput(result, { dictionary: input.dictionary, priorityRule: input.priorityRule, sourceText });
    } catch (error) {
      process.stderr.write(`[fake-analysis] analyze threw: ${(error as Error)?.stack ?? String(error)}\n`);
      throw error;
    }
  }
}

/** 受控 Kano provider：引用已批准资料片段；badRef 模式用于验证伪造引用被拒绝。 */
export class FakeKanoProvider implements KanoProvider {
  readonly model = "controlled-kano-model-v1";
  readonly prompts: string[] = [];
  badRef = false;

  async run(prompt: string): Promise<unknown> {
    process.stderr.write(`[fake-kano] run called badRef=${String(this.badRef)}\n`);
    this.prompts.push(prompt);
    return {
      capabilities: [{
        capability: "导航稳定与偏航重规划",
        audience: "L2",
        positiveQuestion: "如果码表在复杂路口能稳定提示偏航并快速重规划，你的感受是？",
        negativeQuestion: "如果码表在复杂路口偏航后无法及时重规划，你的感受是？",
        simulatedLeaning: { option: "喜欢", rationale: "合成推演：追求训练连续性，不代表真实受访者作答。" },
        candidateType: "期望型",
        explanation: "合成推断：导航稳定更可能影响训练效率与信任感。",
        evidence: [this.badRef ? "S9" : "S1"],
      }],
      gaps: ["L1 缺少直接样本", "未覆盖海外地图数据"],
      confidence: "低",
      confidenceReason: "合成资料覆盖有限，仅作研究假设。",
    };
  }
}

export interface Harness {
  pool: Pool;
  repositories: PostgresRepositories;
  base: FakeBaseClient;
  adapter: FeishuBasePushAdapter;
  analysisProvider: FakeAnalysisProvider;
  kanoProvider: FakeKanoProvider;
  workflow: RequirementWorkflow;
  worker: PipelineJobWorker;
  deps: ApiDependencies;
  tbTasks: unknown[];
  api(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any; text: string }>;
  drain(max?: number): Promise<Array<{ kind: string; jobId?: string }>>;
  resetBusinessData(): Promise<void>;
  setTbTasks(tasks: unknown[]): void;
}

const TRUNCATE_BUSINESS = `TRUNCATE analysis_runs, audit_events, base_push_runs, kano_evidence_versions, kano_runs,
  person_mappings, pipeline_jobs, pm_snapshots, requirement_edit_receipts, requirement_intake_receipts,
  requirements, rice_draft_history, rice_drafts, source_configs, source_snapshots, sync_batches, sync_items
  RESTART IDENTITY CASCADE`;

export async function createHarness(connectionString: string): Promise<Harness> {
  const pool = new Pool({ connectionString, max: 5 });
  const repositories = new PostgresRepositories(pool as never);
  const base = new FakeBaseClient();
  // 与生产组合根一致：真实 transport 外再包一层限流装饰器。
  // 平台键查找必须经装饰器转发，否则手工需求每次推送都会新建 Base 行（目标环境曾复现）。
  const baseClient = new RateLimitedBaseClient(base, { minIntervalMs: 0 });
  const adapter = new FeishuBasePushAdapter(baseClient, BASE_FIELDS, {
    async savePmSnapshot(input) {
      await repositories.pmSnapshots.append({ ...input, capturedAt: new Date().toISOString() });
    },
  });
  const analysisProvider = new FakeAnalysisProvider();
  const kanoProvider = new FakeKanoProvider();
  const workflow = createRequirementWorkflow({
    repositories: repositories as never,
    base: adapter,
    baseFields: BASE_FIELDS,
    fixtureEnvironment: {},
    createProvider: () => analysisProvider,
    createKanoProvider: () => kanoProvider,
    log: (line) => process.stderr.write(`[workflow] ${line}\n`),
  });

  let tbTasks: unknown[] = [];
  const sourceReader: SyncSourceReader = {
    async listRequirements() { return { items: tbTasks as never[], hasMore: false, nextCursor: null }; },
  };
  const syncRunner = async (job: { batchId: string; sourceConfigId: string; mode?: string; actorId: string | null }) => {
    const source = await repositories.sources.get(job.sourceConfigId);
    if (!source) throw new Error("source missing");
    const config: SourceProjectConfig = {
      id: source.id,
      projectId: source.externalProjectId,
      projectName: source.externalProjectName,
      requirementTypeId: source.requirementTypeId,
      enabled: source.enabled,
      schedule: { enabled: source.scheduleEnabled, weekday: source.scheduleWeekday, time: source.scheduleLocalTime, timezone: source.scheduleTimezone },
      ownerNames: source.ownerNames,
      fieldMap: source.fieldMap,
    };
    const persistence = createPostgresSyncPersistence(repositories, job.sourceConfigId);
    const orchestrator = new SyncOrchestrator(sourceReader, persistence);
    const result = await orchestrator.run({
      batchId: job.batchId,
      sourceConfigId: job.sourceConfigId,
      config,
      ...(job.mode === "source_only" ? { mode: "source_only" as const } : {}),
    });
    if (result.status !== "failed" && job.mode !== "source_only") {
      await workflow.dispatchAfterSync({ touched: persistence.touchedRequirements(), actorId: job.actorId });
    }
    return result;
  };

  const worker = new PipelineJobWorker({
    jobs: repositories.jobs,
    sync: syncRunner as never,
    handlers: {
      analysis: async (job: PipelineJobRecord) => { await workflow.handleAnalysisJob(job); },
      base_push: async (job: PipelineJobRecord) => { await workflow.handleBasePushJob(job); },
      kano_run: async (job: PipelineJobRecord) => { await workflow.handleKanoRunJob(job); },
    },
    workerId: "verify-worker",
    leaseMs: 120_000,
  });

  const deps: ApiDependencies = {
    database: pool,
    identity: { requireActor: async () => ({ id: VERIFY_ACTOR }) },
    repositories: repositories as never,
    teambitionSourceProjects: {
      async resolveProject(projectName: string) {
        return { projectId: "tb-project-verify", requirementTypeId: "tb-type-verify", projectName } as never;
      },
    } as never,
    now: () => new Date(),
  };

  async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const request = new Request(new URL(path, "http://verify.local"), {
      method,
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await handleApiRequest(request, deps);
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed, text };
  }

  async function drain(max = 120) {
    const results: Array<{ kind: string; jobId?: string }> = [];
    for (let i = 0; i < max; i += 1) {
      const result = await worker.runOnce();
      results.push(result as { kind: string; jobId?: string });
      if (result.kind !== "idle") continue;
      // 入队使用数据库 now()，worker 比较使用应用时钟；两侧毫秒级偏差会让刚入队的作业
      // 在一次 claim 中不可见。生产由后续轮询兜底，本地验证在这里短暂等待并重试。
      const pending = await pool.query("select count(*)::int n from pipeline_jobs where status='queued' and available_at <= now()");
      if (Number(pending.rows[0]?.n ?? 0) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return results;
  }

  return {
    pool,
    repositories,
    base,
    adapter,
    analysisProvider,
    kanoProvider,
    workflow,
    worker,
    deps,
    get tbTasks() { return tbTasks; },
    setTbTasks(tasks: unknown[]) { tbTasks = tasks; },
    api,
    drain,
    async resetBusinessData() {
      await pool.query(TRUNCATE_BUSINESS);
    },
  } as Harness;
}

export function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    process.stdout.write(`PASS ${name}\n`);
    return;
  }
  process.stdout.write(`FAIL ${name}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}\n`);
  failures.push(name);
}

export function equal(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

export function observe(name: string, condition: boolean, detail?: unknown): void {
  process.stdout.write(`OBSERVED ${condition ? "OK" : "GAP"} ${name}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}\n`);
}

export const failures: string[] = [];
