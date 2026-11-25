import type { RequirementSearchCursor } from "../application/repositories.js";

// Cursor payloads are UTF-8 JSON encoded as base64url so the composite key stays opaque on the wire.
export function encodeRequirementCursor(cursor: RequirementSearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

// 0034：回收站按 (deleted_at, id) 复合排序，游标也必须是同一组键，跨池分页才不重不漏。
export interface DeletedRequirementCursor {
  deletedAt: string;
  id: string;
}

export function encodeDeletedRequirementCursor(cursor: DeletedRequirementCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function decodeRequirementCursor(value: string | undefined): RequirementSearchCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    const { createdAt, id } = parsed as { createdAt?: unknown; id?: unknown };
    if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt)) || typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

export function decodeDeletedRequirementCursor(value: string | undefined): DeletedRequirementCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    const { deletedAt, id } = parsed as { deletedAt?: unknown; id?: unknown };
    if (typeof deletedAt !== "string" || Number.isNaN(Date.parse(deletedAt)) || typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
    return { deletedAt, id };
  } catch {
    return undefined;
  }
}
