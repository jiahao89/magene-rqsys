// 临时验证 C2-B05：用 mock Feishu Base API 跑回填脚本的字段预检。
// 只读取仓库里的脚本并替换 Base 地址，不改仓库文件。
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const exec = promisify(execFile);
const repo = "/Volumes/Files/A_Projects/RQ-Sys";
const dir = "/tmp/c2-b05-test";
mkdirSync(dir, { recursive: true });
const source = readFileSync(join(repo, "scripts/base-source-backfill.mjs"), "utf8");
const patched = source.replace('const feishu = "https://open.feishu.cn";', 'const feishu = process.env.MOCK_FEISHU_BASE;');
if (patched === source) throw new Error("未找到 Feishu base URL 行");
const scriptPath = join(dir, "backfill-mock.mjs");
writeFileSync(scriptPath, patched);

const reqsPath = join(dir, "reqs.json");
writeFileSync(reqsPath, JSON.stringify([
  { platformRequirementId: "RQ-TEST", sourceType: "teambition", source: {} },
]));

function startMock(fields, records) {
  const calls = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    calls.push(`${req.method} ${url.pathname}`);
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/open-apis/auth/v3/tenant_access_token/internal") {
      res.end(JSON.stringify({ code: 0, tenant_access_token: "t", expire: 7200 }));
      return;
    }
    if (url.pathname.endsWith("/fields")) {
      res.end(JSON.stringify({ code: 0, data: { items: fields } }));
      return;
    }
    if (url.pathname.endsWith("/records")) {
      res.end(JSON.stringify({ code: 0, data: { items: records } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ code: 1254040, msg: "not found" }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, calls }));
  });
}

async function runCase(name, fields, records, expect) {
  const mock = await startMock(fields, records);
  const csv = join(dir, `${name}.csv`);
  let stdout = "";
  let stderr = "";
  let status = 0;
  try {
    const result = await exec("node", [scriptPath, "--requirements-file", reqsPath, "--csv", csv, "--delay-ms", "0"], {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        MOCK_FEISHU_BASE: mock.base,
        FEISHU_APP_ID: "app-id",
        FEISHU_APP_SECRET: "app-secret",
        BASE_APP_TOKEN: "app-token",
        BASE_TABLE_ID: "table-id",
        BASE_FIELDS_JSON: JSON.stringify({ sourceMethod: "来源方式" }),
        RQSYS_COOKIE: "",
        RQSYS_AUTHORIZATION: "",
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    status = typeof error.code === "number" ? error.code : 1;
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? String(error.message ?? error);
  }
  mock.server.close();
  const output = `${stdout}\n${stderr}`;
  const ok = expect(status, output, csv);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (exit=${status})`);
  if (!ok) console.log(output.slice(0, 1500));
  return ok;
}

const fullOptions = ["Teambition", "Web 手工", "多维表格", "聊天粘贴"];
let allOk = true;
allOk = await runCase(
  "type-text",
  [{ field_name: "需求平台ID", type: 1 }, { field_name: "来源方式", type: 1 }],
  [],
  (status, out) => status === 1 && out.includes("类型必须是单选"),
) && allOk;
allOk = await runCase(
  "missing-option",
  [{ field_name: "需求平台ID", type: 1 }, { field_name: "来源方式", type: 3, property: { options: fullOptions.slice(0, 3).map((name) => ({ name })) } }],
  [],
  (status, out) => status === 1 && out.includes("选项不完整") && out.includes("聊天粘贴"),
) && allOk;
allOk = await runCase(
  "ok-already-correct",
  [{ field_name: "需求平台ID", type: 1 }, { field_name: "来源方式", type: 3, property: { options: fullOptions.map((name) => ({ name })) } }],
  [{ record_id: "rec1", fields: { 需求平台ID: "RQ-TEST", 来源方式: "Teambition" } }],
  (status, out, csv) => status === 0 && out.includes('"alreadyCorrect":1') && readFileSync(csv, "utf8").includes("already_correct"),
) && allOk;
allOk = await runCase(
  "ok-would-write",
  [{ field_name: "需求平台ID", type: 1 }, { field_name: "来源方式", type: 3, property: { options: fullOptions.map((name) => ({ name })) } }],
  [{ record_id: "rec1", fields: { 需求平台ID: "RQ-TEST", 来源方式: "" } }],
  (status, out, csv) => status === 0 && out.includes('"wouldWrite":1') && readFileSync(csv, "utf8").includes("would_write"),
) && allOk;

process.exitCode = allOk ? 0 : 1;
