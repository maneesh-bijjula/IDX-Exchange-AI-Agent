export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:3125/message";
export const DEFAULT_USER_ID = "whatsapp-demo-user";
export const DEFAULT_TIMEOUT_MS = 65_000;
export const BRIDGE_UNAVAILABLE_MESSAGE =
  "The IDX multi-agent coordinator is not running yet. Please start it, then try again.";

export type RelayConfig = {
  bridgeUrl: string;
  userId: string;
  allowedSender: string | null;
  timeoutMs: number;
};

export type RelayContext = {
  messageProvider?: string;
  channel?: string;
  chatId?: string;
  senderId?: string;
  channelId?: string;
  sessionKey?: string;
};

export type RelayResult = {
  handled: boolean;
  reply?: { text: string };
  reason?: string;
};

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readTimeout(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1_000
    ? Math.min(value, 120_000)
    : DEFAULT_TIMEOUT_MS;
}

export function resolveRelayConfig(raw: Record<string, unknown> = {}): RelayConfig {
  return {
    bridgeUrl: readString(raw.bridgeUrl, DEFAULT_BRIDGE_URL),
    userId: readString(raw.userId, DEFAULT_USER_ID),
    allowedSender:
      typeof raw.allowedSender === "string" && raw.allowedSender.trim()
        ? raw.allowedSender.trim()
        : null,
    timeoutMs: readTimeout(raw.timeoutMs),
  };
}

function digits(value: string | undefined): string {
  return value?.replace(/\D/g, "") ?? "";
}

export function shouldRelayWhatsappMessage(
  message: string,
  context: RelayContext,
  allowedSender: string | null,
): boolean {
  const normalizedMessage = message.trim();
  if (!normalizedMessage || normalizedMessage.startsWith("/")) return false;

  const provider = (context.messageProvider ?? context.channel ?? "").toLowerCase();
  const isWhatsapp =
    provider === "whatsapp" || context.sessionKey?.toLowerCase().includes("whatsapp") === true;
  if (!isWhatsapp) return false;
  if (!allowedSender) return true;

  const expected = digits(allowedSender);
  return [context.senderId, context.chatId, context.channelId, context.sessionKey].some(
    (candidate) => digits(candidate).includes(expected),
  );
}

export async function relayToCoordinator(
  message: string,
  config: RelayConfig,
  fetcher: FetchLike = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetcher(config.bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: config.userId, message: message.trim() }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("IDX coordinator returned a non-success response");

    const payload = await response.json();
    const text =
      typeof payload === "object" && payload !== null && "response" in payload
        ? (payload as { response?: unknown }).response
        : null;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("IDX coordinator response did not include text");
    }
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

export function createWhatsappRelayHandler(
  config: RelayConfig,
  options: {
    fetcher?: FetchLike;
    onError?: (error: unknown) => void;
  } = {},
) {
  return async (
    event: { cleanedBody: string },
    context: RelayContext,
  ): Promise<RelayResult | undefined> => {
    if (!shouldRelayWhatsappMessage(event.cleanedBody, context, config.allowedSender)) {
      return undefined;
    }

    try {
      const text = await relayToCoordinator(event.cleanedBody, config, options.fetcher);
      return {
        handled: true,
        reply: { text },
        reason: "idx-whatsapp-relay",
      };
    } catch (error) {
      options.onError?.(error);
      return {
        handled: true,
        reply: { text: BRIDGE_UNAVAILABLE_MESSAGE },
        reason: "idx-whatsapp-relay-unavailable",
      };
    }
  };
}
