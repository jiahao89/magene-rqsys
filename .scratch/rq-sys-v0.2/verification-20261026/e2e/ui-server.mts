// 本地 UI 验证服务器：真实 HTTP + 真实 PostgreSQL + 受控 AI/Base + worker 轮询。
// 供 Vite 开发服务器代理（API_PROXY_TARGET=http://127.0.0.1:8791），用于浏览器端到端点检。
import { createServer } from "node:http";
import { createHarness } from "./fixtures.mts";
import { handleApiRequest } from "../../../../apps/api/src/http/app.js";

const connectionString = process.env.VERIFY_DATABASE_URL
  ?? `postgresql://postgres@/rq_verify_20261026?host=${process.env.HOME}/.local/share/rq-sys/postgres`;
const h = await createHarness(connectionString);
const port = Number(process.env.VERIFY_UI_API_PORT ?? 8791);

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) headers.set(key, value.join(", "));
      else if (value !== undefined) headers.set(key, value);
    }
    const request = new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
      method: incoming.method ?? "GET",
      headers,
      ...(body.length > 0 ? { body } : {}),
    });
    const response = await handleApiRequest(request, h.deps);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    process.stderr.write(`[ui-server] ${(error as Error).name}: ${(error as Error).message}\n`);
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "application/json; charset=utf-8");
    outgoing.end(JSON.stringify({ error: { code: "INTERNAL", message: "Internal error" } }));
  }
});
server.listen(port, "127.0.0.1", () => process.stdout.write(`verify UI API on :${port}\n`));

const timer = setInterval(() => {
  void h.drain().catch((error) => process.stderr.write(`[ui-server] worker: ${(error as Error).message}\n`));
}, 250);

async function shutdown() {
  clearInterval(timer);
  server.close();
  await h.pool.end();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
