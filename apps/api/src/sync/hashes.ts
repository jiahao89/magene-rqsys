import { createHash } from "node:crypto";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export interface SubstantiveSourceFields {
  title: string;
  description: string | null;
  scope: string | null;
  acceptanceCriteria: string | null;
  attachmentRefs: readonly string[];
  ownerId?: string | null;
  statusId?: string | null;
  updatedAt?: string | null;
}

export function substantiveHash(source: SubstantiveSourceFields): string {
  return stableHash({
    title: source.title,
    description: source.description,
    scope: source.scope,
    acceptanceCriteria: source.acceptanceCriteria,
    attachmentRefs: [...source.attachmentRefs].sort(),
  });
}

export function isSubstantiveChange(previousHash: string | null, nextHash: string): boolean {
  return previousHash !== null && previousHash !== nextHash;
}
