/**
 * 外部链接协议白名单：只允许 http:// 或 https://，且拒绝带账号密码的 URL。
 * 用于防御 `javascript:`、`data:` 等不安全协议落入 `<a href>`。
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return trimmed;
  } catch {
    return null;
  }
}
