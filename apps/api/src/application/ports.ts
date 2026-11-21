import type {
  NormalizedTeambitionRequirement,
  SourceProjectConfig,
} from "../domain/workflow.js";
import type { SourcePool } from "../domain/persistence.js";
import type { TeambitionTaskRecord } from "../adapters/teambition/raw-types.js";

export interface TeambitionSourcePort {
  listRequirementTasks(config: SourceProjectConfig): Promise<TeambitionTaskRecord[]>;
}

export interface TeambitionSourceProjectResolver {
  /**
   * 解析 TB 项目与需求任务类型。
   * pool=group 时允许多个候选里按确定性规则取精确名「需求」；其余情况保持“唯一候选”约束。
   */
  resolveProject(projectName: string, options?: { pool?: SourcePool }): Promise<{ projectId: string; requirementTypeId: string }>;
}

/**
 * 组织成员目录：集团池执行人名单在保存时把展示名解析为 TB user_id。
 * 仅供服务端解析，名单本身只回传展示名，不向浏览器暴露 user_id。
 */
export interface TeambitionMemberDirectory {
  listOrganizationMembers(): Promise<Array<{ userId: string; name: string }>>;
}

export class SourceProjectResolutionError extends Error {
  constructor(
    readonly reason: "project_not_found" | "project_ambiguous" | "requirement_type_not_found" | "requirement_type_ambiguous",
    message: string,
  ) {
    super(message);
    this.name = "SourceProjectResolutionError";
  }
}

export interface RequirementRepository {
  upsertSourceRequirement(
    requirement: NormalizedTeambitionRequirement,
    sourceHash: string,
  ): Promise<{ id: string; changed: boolean; sourceVersion: number }>;
}

export interface IdentityProvider {
  requireActor(request: Request): Promise<{ id: string }>;
}

export interface FeishuUserCandidate {
  openId: string;
  /** 飞书 user_id（search API 新旧版本都可能返回）；Base 人员字段优先使用它。 */
  userId?: string;
  name: string;
  enName?: string;
}

export interface FeishuUserSelection {
  feishuUserId: string;
  feishuIdType: "open_id" | "user_id" | "union_id";
  name: string;
}

export interface FeishuUserSelectionResolver {
  resolve(platformUserId: string): Promise<FeishuUserSelection | null>;
}

export interface FeishuUserDirectory {
  search(query: string): Promise<FeishuUserCandidate[]>;
}

export type FeishuDirectoryFailurePhase = "tenant_token" | "user_search" | "platform_configuration" | "platform_employee" | "platform_profile";
export type FeishuDirectoryFailureReason = "network_error" | "http_error" | "provider_error" | "invalid_response";

// Safe, bounded diagnostics only. Never retain provider messages, tokens, or request payloads.
export class FeishuDirectoryFailure extends Error {
  constructor(
    readonly phase: FeishuDirectoryFailurePhase,
    readonly reason: FeishuDirectoryFailureReason,
    readonly httpStatus?: number,
    readonly providerCode?: number,
  ) {
    super("Feishu user directory request failed.");
    this.name = "FeishuDirectoryFailure";
  }
}
