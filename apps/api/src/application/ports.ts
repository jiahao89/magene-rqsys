import type {
  NormalizedTeambitionRequirement,
  SourceProjectConfig,
} from "../domain/workflow.js";
import type { TeambitionTaskRecord } from "../adapters/teambition/raw-types.js";

export interface TeambitionSourcePort {
  listRequirementTasks(config: SourceProjectConfig): Promise<TeambitionTaskRecord[]>;
}

export interface TeambitionSourceProjectResolver {
  resolveProject(projectName: string): Promise<{ projectId: string; requirementTypeId: string }>;
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
  requireActor(request: Request): Promise<{
    id: string;
    roles: string[];
  }>;
}

export interface FeishuUserCandidate {
  openId: string;
  name: string;
  enName?: string;
}

export interface FeishuUserDirectory {
  search(query: string): Promise<FeishuUserCandidate[]>;
}
