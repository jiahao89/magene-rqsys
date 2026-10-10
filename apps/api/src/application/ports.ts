import type {
  NormalizedTeambitionRequirement,
  SourceProjectConfig,
} from "../domain/workflow.js";
import type { TeambitionTaskRecord } from "../adapters/teambition/raw-types.js";

export interface TeambitionSourcePort {
  listRequirementTasks(config: SourceProjectConfig): Promise<TeambitionTaskRecord[]>;
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
