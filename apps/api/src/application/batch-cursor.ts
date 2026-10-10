import type { SyncBatchSearchCursor } from "./repositories.js";

export function encodeBatchCursor(cursor: SyncBatchSearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeBatchCursor(value: string | undefined): SyncBatchSearchCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    const { startedAt, id } = parsed as { startedAt?: unknown; id?: unknown };
    if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt)) || typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) return undefined;
    return { startedAt, id };
  } catch {
    return undefined;
  }
}
