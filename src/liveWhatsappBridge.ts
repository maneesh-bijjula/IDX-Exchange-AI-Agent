import http from "node:http";
import { handlePropertySearchMessage } from "./conversationalPropertyAgent.ts";
import { closeDatabase } from "./database.ts";

const DEFAULT_PORT = 3124;
const port = Number(process.env.IDX_AGENT_PORT ?? DEFAULT_PORT);

type BridgeRequest = {
  userId?: string;
  message?: string;
  page?: number;
  limit?: number;
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

function normalizeRequest(rawBody: string): BridgeRequest {
  if (!rawBody.trim()) return {};
  const parsed = JSON.parse(rawBody);
  return typeof parsed === "object" && parsed !== null ? parsed : {};
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "idx-property-search-agent",
      port,
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/message") {
    sendJson(response, 404, {
      error: "Use POST /message with { userId, message }.",
    });
    return;
  }

  try {
    const body = normalizeRequest(await readRequestBody(request));
    const message = body.message?.trim();
    const userId = body.userId?.trim() || "whatsapp-demo-user";

    if (!message) {
      sendJson(response, 400, {
        error: "Missing required field: message",
      });
      return;
    }

    const result = await handlePropertySearchMessage(userId, message, {
      page: body.page,
      limit: body.limit,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown bridge error",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`IDX property search bridge running at http://127.0.0.1:${port}`);
  console.log("POST /message with JSON: { \"userId\": \"whatsapp-demo-user\", \"message\": \"Find homes in Irvine\" }");
});

async function shutdown(): Promise<void> {
  console.log("\nShutting down IDX property search bridge...");
  server.close();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
