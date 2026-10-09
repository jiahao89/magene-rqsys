import type { RequirementSearchCursor } from "../application/repositories.js";

// Cursor payloads are UTF-8 JSON encoded as base64url so the composite key stays opaque on the wire.
export function encodeRequirementCursor(cursor: RequirementSearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeRequirementCursor(value: string | undefined): RequirementSearchCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    const { createdAt, id } = parsed as { createdAt?: unknown; id?: unknown };
    if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt)) || typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}
