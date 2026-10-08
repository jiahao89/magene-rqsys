import { createServer } from "node:http";
import { createPool } from "./adapters/postgres/pool.js";
import { handleApiRequest } from "./http/app.js";

const port = Number(process.env.PORT ?? 8787);
const database = createPool(process.env.DATABASE_URL);

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
    const response = await handleApiRequest(request, { database });
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "application/json; charset=utf-8");
    outgoing.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Request failed." } }));
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`RQ-Sys API listening on :${port}\n`);
});

async function shutdown(): Promise<void> {
  server.close();
  await database?.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

