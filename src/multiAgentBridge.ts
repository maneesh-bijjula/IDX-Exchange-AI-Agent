import http from "node:http";
import { closeDatabase } from "./database.ts";
import { onWhatsAppMessage } from "./whatsappCommunication.ts";

const DEFAULT_PORT = 3125;
const port = Number(process.env.IDX_ORCHESTRATOR_PORT ?? DEFAULT_PORT);

type BridgeRequest = {
  userId?: string;
  message?: string;
};

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "idx-whatsapp-communication-layer",
      port,
      agents: 5,
      channel: "whatsapp",
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/message") {
    sendJson(response, 404, { error: "Use POST /message with { userId, message }." });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const parsed = rawBody.trim() ? JSON.parse(rawBody) : {};
    const body: BridgeRequest = typeof parsed === "object" && parsed !== null ? parsed : {};
    const message = body.message?.trim();
    const userId = body.userId?.trim() || "whatsapp-demo-user";

    if (!message) {
      sendJson(response, 400, { error: "Missing required field: message" });
      return;
    }

    const result = await onWhatsAppMessage(message, userId);
    sendJson(response, result.ok ? 200 : 500, result);
  } catch (error) {
    const nested = error instanceof AggregateError ? error.errors[0] : null;
    sendJson(response, 500, {
      error:
        error instanceof Error && error.message
          ? error.message
          : nested instanceof Error
            ? nested.message
            : "Unknown orchestrator error",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`IDX multi-agent orchestrator running at http://127.0.0.1:${port}`);
  console.log('POST /message with { "userId": "demo", "message": "What does DOM mean?" }');
});

async function shutdown(): Promise<void> {
  console.log("\nShutting down IDX multi-agent orchestrator...");
  server.close();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
