import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { logger } from "../util/log.js";
import { handleChatCompletions } from "./routes.js";
import type { ProxyContext } from "./context.js";

export interface ProxyServer {
  close(): Promise<void>;
  port: number;
}

export async function startProxy(ctx: ProxyContext): Promise<ProxyServer> {
  const requested = ctx.config.proxy.port;
  const server: Server = createServer((req, res) => {
    handleRequest(req, res, ctx).catch((err) => {
      logger.error("unhandled request error", { err: (err as Error).message });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "internal proxy error" } }));
      }
    });
  });

  let port: number;
  if (requested === 0) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, ctx.config.proxy.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("listening but no port assigned");
    }
    port = addr.port;
  } else {
    port = await findAvailablePort(ctx.config.proxy.host, requested);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, ctx.config.proxy.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  }
  ctx.config.proxy.port = port;

  logger.info("proxy started", { port, host: ctx.config.proxy.host });

  return {
    port,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: ProxyContext): Promise<void> {
  const url = req.url ?? "/";
  if (req.method === "GET" && (url === "/health" || url === "/")) {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, name: "opencode-autopilot", version: "0.1.0" }));
    return;
  }
  if (req.method === "GET" && url === "/v1/models") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ object: "list", data: [{ id: "auto", object: "model", owned_by: "router" }] }));
    return;
  }
  if (req.method === "POST" && url === "/v1/chat/completions") {
    return handleChatCompletions(req, res, ctx);
  }
  res.statusCode = 404;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: { message: `no route for ${req.method} ${url}` } }));
}

async function findAvailablePort(host: string, start: number, attempts = 20): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const port = start + i;
    if (await isPortFree(host, port)) return port;
  }
  throw new Error(`no available port in [${start}, ${start + attempts})`);
}

function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}
