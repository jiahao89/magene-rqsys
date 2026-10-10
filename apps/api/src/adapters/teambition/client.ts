import type { SourceProjectConfig } from "../../domain/workflow.js";
import type { TeambitionTaskRecord } from "./raw-types.js";
import { SourceProjectResolutionError, type TeambitionSourceProjectResolver } from "../../application/ports.js";

const SKILL_GATEWAY_URL = "";
const DEFAULT_GATEWAY_API_KEY = "";

export class TeambitionApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = "TeambitionApiError";
  }
}

export interface TeambitionClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface NamedTeambitionEntity { id: string; name: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function namedEntities(payload: unknown): NamedTeambitionEntity[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((value) => {
      const item = asRecord(value);
      if (!item) return [];
      const id = item._id ?? item.id ?? item.project_id ?? item.config_id ?? item.scenariofield_config_id;
      const name = item.name ?? item.project_name ?? item.title ?? item.config_name ?? item.scenariofield_config_name;
      return typeof id === "string" && typeof name === "string" ? [{ id, name }] : [];
    });
  }

  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["projects", "items", "data", "configs", "scenariofield_configs"]) {
    if (key in record) {
      const nested = namedEntities(record[key]);
      if (nested.length > 0) return nested;
    }
  }
  return Object.entries(record).flatMap(([key, value]) => {
    if (typeof value === "string") return [{ id: key, name: value }];
    const item = asRecord(value);
    if (!item) return [];
    const id = item._id ?? item.id ?? item.project_id ?? item.config_id ?? item.scenariofield_config_id ?? key;
    const name = item.name ?? item.project_name ?? item.title ?? item.config_name ?? item.scenariofield_config_name;
    return typeof id === "string" && typeof name === "string" ? [{ id, name }] : [];
  });
}

function normalizeName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export class TeambitionClient implements TeambitionSourceProjectResolver {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: TeambitionClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.TEAMBITION_GATEWAY_URL ?? SKILL_GATEWAY_URL).replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.GATEWAY_API_KEY ?? DEFAULT_GATEWAY_API_KEY;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!this.baseUrl) throw new Error("Teambition gateway URL is not configured");
    if (!this.apiKey) throw new Error("Teambition gateway API key is not configured");
  }

  private async getJson(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new TeambitionApiError("Teambition gateway is unreachable or timed out", null);
    }
    if (!response.ok) throw new TeambitionApiError(`Teambition gateway returned HTTP ${response.status}`, response.status);
    try {
      return await response.json();
    } catch {
      throw new TeambitionApiError("Teambition gateway returned invalid JSON", response.status);
    }
  }

  async resolveProject(projectName: string): Promise<{ projectId: string; requirementTypeId: string }> {
    const targetName = normalizeName(projectName);
    const projects = namedEntities(await this.getJson("getProjects"))
      .filter((project) => normalizeName(project.name) === targetName);
    if (projects.length === 0) {
      throw new SourceProjectResolutionError("project_not_found", `未找到名为“${projectName}”的 Teambition 项目。请检查项目名称。`);
    }
    if (projects.length > 1) {
      throw new SourceProjectResolutionError("project_ambiguous", "该项目名称匹配到多个 Teambition 项目，请联系管理员确认唯一项目名称。");
    }

    const project = projects[0]!;
    const scenarioFields = namedEntities(await this.getJson("getProjectScenarioFieldConfigs", { project_id: project.id }));
    const candidates = scenarioFields.filter(({ name }) => /需求|requirement/i.test(name) && !/缺陷|bug|defect/i.test(name));
    const exact = candidates.filter(({ name }) => ["需求", "requirement"].includes(normalizeName(name).toLocaleLowerCase()));
    const selected = exact.length === 1 ? exact : exact.length > 1 ? exact : candidates;
    if (selected.length === 0) {
      throw new SourceProjectResolutionError("requirement_type_not_found", `项目“${projectName}”中没有可识别的需求任务类型。`);
    }
    if (selected.length > 1) {
      throw new SourceProjectResolutionError("requirement_type_ambiguous", `项目“${projectName}”中存在多个需求任务类型，无法自动确定同步范围。`);
    }
    return { projectId: project.id, requirementTypeId: selected[0]!.id };
  }

  async listRequirementTasks(config: SourceProjectConfig): Promise<TeambitionTaskRecord[]> {
    const payload = await this.getJson("getProjectTasks", {
      project_id: config.projectId,
      scenariofield_config_id: config.requirementTypeId,
    });
    if (!Array.isArray(payload)) {
      throw new TeambitionApiError("Teambition gateway returned an unexpected task-list shape", 200);
    }
    return payload as TeambitionTaskRecord[];
  }
}
