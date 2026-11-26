import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./safe-url";

describe("safeHttpUrl", () => {
  it("accepts clean http and https URLs", () => {
    expect(safeHttpUrl("https://www.teambition.com/task/123")).toBe("https://www.teambition.com/task/123");
    expect(safeHttpUrl("  http://example.com/path?a=1#sec  ")).toBe("http://example.com/path?a=1#sec");
    expect(safeHttpUrl("HTTPS://feishu.cn/base/app123")).toBe("HTTPS://feishu.cn/base/app123");
  });

  it("rejects dangerous protocols, credentials, relative paths, and empty values", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("JAVASCRIPT:void(0)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
    expect(safeHttpUrl("https://user:secret@example.com/path")).toBeNull();
    expect(safeHttpUrl("https://token@example.com/path")).toBeNull();
    expect(safeHttpUrl("/relative/path")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("   ")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});
