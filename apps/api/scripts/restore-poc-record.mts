// POC 测试记录恢复：重建被 2026-10-09 冒烟事故误删的 recvxrwaGzPGJd（poc_req_0001）。
// 已知字段来自删除前的完整读取快照（忠实还原）；未知文本字段以「（已恢复）」标记占位。
import { spawnSync } from "node:child_process";

const APP_TOKEN = "OddqbqBeOamFjFsR5IXcJdjknmd";
const TABLE_ID = "tblxbyvbdLGVnLaO";

function larkCliProxy(method: string, path: string, body?: unknown): { code?: number; data?: { record?: { record_id: string } } } {
  const args = ["api", method, path];
  if (body !== undefined) args.push("--data", JSON.stringify(body));
  const result = spawnSync("lark-cli", args, { encoding: "utf8", timeout: 60_000 });
  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error(`lark-cli returned empty stdout (exit ${result.status}, stderr: ${result.stderr.trim().slice(0, 300)})`);
  }
  const parsed = JSON.parse(stdout) as { ok?: boolean; code?: number; data?: { record?: { record_id: string } } };
  return { code: parsed.code ?? (parsed.ok === true ? 0 : 1), data: parsed.data };
}

// 删除前快照中的字段（2026-10-09 冒烟事故前读取）
const restored = larkCliProxy("POST", `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
  fields: {
    标题: "POC 测试记录 1（2026-10-09 误删后恢复）",
    TB需求ID: "poc_req_0001",
    TB项目ID: "poc_project_A",
    任务类型: "需求收集",
    需求说明: "（已恢复）原记录文本值未留档；本记录用于验证复合键幂等与 PM 字段协议。",
    TB状态: "进行中",
    TB创建时间: "2026-10-08 16:00",
    TB更新时间: "2026-10-08 16:50",
    TB链接: { link: "https://example.com/poc-req-0001", text: "https://example.com/poc-req-0001" },
    AI模块建议: "需求澄清",
    AI分析版本: "ai-v1",
    AI优先级建议: "P1",
    PM状态: "待处理",
    PM确认模块: "方案设计",
    PM确认优先级: "P0",
    处理人: [{ id: "ou_894482287d1f95aff25b5550604167fb" }],
  },
});

if (restored.code !== 0 || !restored.data?.record) {
  console.log(`RESTORE-FAIL code=${restored.code}`);
} else {
  console.log(`RESTORE-OK recordId=${restored.data.record.record_id}`);
  // 用修复后的复合键搜索验证恢复成功
  const check = larkCliProxy("POST", `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/search`, {
    filter: {
      conjunction: "and",
      conditions: [
        { field_name: "TB需求ID", op: "is", value: ["poc_req_0001"] },
        { field_name: "TB项目ID", op: "is", value: ["poc_project_A"] },
      ],
    },
  });
  const items = (check.data as { items?: Array<{ record_id: string }> } | undefined)?.items ?? [];
  console.log(`VERIFY-SEARCH hits=${items.length} ids=${items.map((i) => i.record_id).join(",")}`);
}
