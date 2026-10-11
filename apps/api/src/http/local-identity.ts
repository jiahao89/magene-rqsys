// 本地开发身份适配器：让平台中立的 root API 能在本机被真实工作台调用。
//
// 安全边界（三层，缺一不可，避免它变成生产身份旁路）：
//   1. 必须显式设置 `RQSYS_LOCAL_IDENTITY`（默认关闭，未设置时 server.ts 仍保持 fail-closed）；
//   2. `NODE_ENV=production` 时无论变量如何都拒绝启用；
//   3. 只接受来自本机（localhost/127.0.0.1）的请求。
//
// 请求头名称与妙搭 app 的可信契约保持一致，便于本地与目标环境行为对齐：
// 目标环境由 `withMiaodaUserContext` 清除外部伪造头后写入；本地由 Vite 代理注入。

import type { IdentityProvider } from "../application/ports.js";

export const PLATFORM_USER_ID_HEADER = "x-rqsys-platform-user-id";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

export interface LocalIdentityOptions {
  /** 环境变量显式给出的本地身份 ID；未设置或为空白表示未启用。 */
  userId?: string | undefined;
  /** 服务进程自身的 NODE_ENV；为 production 时拒绝启用。 */
  nodeEnv?: string | undefined;
  /** 允许的请求头名称，默认与妙搭契约一致。 */
  headerName?: string | undefined;
}

export class LocalIdentityDisabledError extends Error {
  constructor(reason: string) {
    super(`Local development identity is not enabled: ${reason}`);
    this.name = "LocalIdentityDisabledError";
  }
}

/**
 * 仅当显式授权且在非生产环境时返回适配器；否则返回 undefined，调用方须保持原有 fail-closed 行为。
 */
export function createLocalIdentityProvider(options: LocalIdentityOptions = {}): IdentityProvider | undefined {
  const userId = options.userId?.trim();
  if (!userId) return undefined;
  if ((options.nodeEnv ?? "development") === "production") return undefined;
  if (userId.length > 128 || /[\u0000-\u001f\u007f]/u.test(userId)) {
    throw new LocalIdentityDisabledError("configured local user id is not a valid identity string");
  }
  const headerName = options.headerName?.trim() || PLATFORM_USER_ID_HEADER;
  return {
    async requireActor(request: Request): Promise<{ id: string }> {
      const host = new URL(request.url).hostname;
      if (!LOOPBACK_HOSTS.has(host)) {
        throw new Error("Local development identity is restricted to loopback requests");
      }
      const presented = request.headers.get(headerName)?.trim();
      if (!presented) {
        throw new Error("Local development identity header is missing on this request");
      }
      if (presented.length > 128 || /[\u0000-\u001f\u007f]/u.test(presented)) {
        throw new Error("Local development identity header is not a valid identity string");
      }
      // 默认使用配置的本地身份；显式传入的 header 允许本地模拟第二个用户，用于验证隔离行为。
      return { id: presented || userId };
    },
  };
}

/** 供启动日志使用：描述已启用的本地身份，但不打印任何可复用凭据。 */
export function describeLocalIdentity(userId: string | undefined, nodeEnv: string | undefined): string | null {
  const id = userId?.trim();
  if (!id) return null;
  if ((nodeEnv ?? "development") === "production") return null;
  return `Local development identity enabled for "${id}" (loopback only; never a production identity path)`;
}
