import type { SourceProjectConfig } from "../../domain/workflow.js";
import type { TeambitionTaskRecord } from "./raw-types.js";

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

export class TeambitionClient {
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

  async listRequirementTasks(config: SourceProjectConfig): Promise<TeambitionTaskRecord[]> {
    const url = new URL(`${this.baseUrl}/getProjectTasks`);
    url.searchParams.set("project_id", config.projectId);
    url.searchParams.set("scenariofield_config_id", config.requirementTypeId);

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

    if (!response.ok) {
      throw new TeambitionApiError(`Teambition gateway returned HTTP ${response.status}`, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TeambitionApiError("Teambition gateway returned invalid JSON", response.status);
    }
    if (!Array.isArray(payload)) {
      throw new TeambitionApiError("Teambition gateway returned an unexpected task-list shape", response.status);
    }
    return payload as TeambitionTaskRecord[];
  }
}

