export interface OwnerMapping {
  teambitionUserId: string | null;
  displayName: string | null;
  feishuUserId: string;
  active: boolean;
  manuallySelected: boolean;
}

export type OwnerResolution =
  | { state: "auto_mapped"; feishuUserId: string; matchMethod: "tb_user_id" | "unique_name" }
  | { state: "manually_mapped"; feishuUserId: string; matchMethod: "manual" }
  | { state: "not_required"; feishuUserId: null }
  | { state: "pending_mapping"; reason: "ambiguous" | "unmatched" };

export interface TeambitionOwner {
  teambitionUserId: string | null;
  displayName: string | null;
}

export function normalizeOwnerName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function resolveOwnerMapping(
  owner: TeambitionOwner,
  mappings: readonly OwnerMapping[],
  manualMapping?: OwnerMapping,
): OwnerResolution {
  if (owner.teambitionUserId === null && !owner.displayName?.trim()) {
    if (manualMapping?.active && manualMapping.manuallySelected) {
      return { state: "manually_mapped", feishuUserId: manualMapping.feishuUserId, matchMethod: "manual" };
    }
    return { state: "not_required", feishuUserId: null };
  }

  if (owner.teambitionUserId === null && owner.displayName?.trim()) {
    const normalized = normalizeOwnerName(owner.displayName);
    const candidates = mappings.filter((mapping) =>
      mapping.active && !mapping.manuallySelected && mapping.teambitionUserId === null && mapping.displayName !== null &&
      normalizeOwnerName(mapping.displayName) === normalized
    );
    if (candidates.length === 1) {
      return { state: "auto_mapped", feishuUserId: candidates[0]!.feishuUserId, matchMethod: "unique_name" };
    }
    if (candidates.length > 1) return { state: "pending_mapping", reason: "ambiguous" };
  }

  if (owner.teambitionUserId !== null) {
    const byId = mappings.find((mapping) =>
      mapping.active && mapping.teambitionUserId === owner.teambitionUserId
    );
    if (byId) {
      if (byId.manuallySelected) {
        return { state: "manually_mapped", feishuUserId: byId.feishuUserId, matchMethod: "manual" };
      }
      return { state: "auto_mapped", feishuUserId: byId.feishuUserId, matchMethod: "tb_user_id" };
    }
  }

  if (manualMapping?.active && manualMapping.manuallySelected) {
    return { state: "manually_mapped", feishuUserId: manualMapping.feishuUserId, matchMethod: "manual" };
  }
  return { state: "pending_mapping", reason: "unmatched" };
}
