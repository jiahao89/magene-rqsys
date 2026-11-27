// 轻量级内存 TTL 缓存（默认 60s），用于人员、功能模块、数据源与「我的需求」计数等低频变更参考数据。
// 特点：
// 1. 同一键并发请求自动去重（inflight dedupe），避免多个组件挂载时重复打接口；
// 2. 失败/取消不缓存，确保下次能重试；
// 3. 写操作显式调用 invalidateQueryCache(key) 立即失效；测试环境通过 clearQueryCache() 彻底隔离。

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export const CACHE_KEYS = {
  people: "people",
  modules: "modules",
  sources: "sources",
  myRequirementCounts: "my-requirement-counts",
} as const;

export function readCachedQuery<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export async function cachedQuery<T>(
  key: string,
  load: () => Promise<T>,
  options: { ttlMs?: number; bypass?: boolean } = {},
): Promise<T> {
  const { ttlMs = DEFAULT_TTL_MS, bypass = false } = options;
  if (!bypass) {
    const hit = readCachedQuery<T>(key);
    if (hit !== undefined) return hit;
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }
  const promise = load()
    .then((value) => {
      if (!bypass) store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  if (!bypass) inflight.set(key, promise);
  return promise;
}

export function invalidateQueryCache(...keys: string[]): void {
  for (const key of keys) {
    store.delete(key);
    inflight.delete(key);
  }
}

export function clearQueryCache(): void {
  store.clear();
  inflight.clear();
}
