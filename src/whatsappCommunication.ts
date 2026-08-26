import {
  orchestrate,
  type OrchestratorResponse,
} from "./orchestrator.ts";

export const WHATSAPP_ERROR_MESSAGE =
  "Sorry, I hit an issue while processing that request. Please try again.";
export const WHATSAPP_EMPTY_MESSAGE =
  "Please send a property search, market question, recommendation request, or real estate question.";

export type WhatsAppCommunicationResult = OrchestratorResponse & {
  ok: boolean;
};

export type WhatsAppOrchestrator = (
  message: string,
  userId: string,
) => Promise<OrchestratorResponse>;

export type WhatsAppCommunicationOptions = {
  orchestrator?: WhatsAppOrchestrator;
  sendTypingIndicator?: (userId: string) => Promise<void> | void;
  logger?: {
    error(message: string, error?: unknown): void;
  };
};

function normalizeWhatsAppText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\[([^\]]+)]\((?:#|link)\)/gi, "$1")
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/gi, "$1: $2")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatForWhatsApp(result: OrchestratorResponse): string {
  const email = result.sections.find(
    (section) => section.agent === "emailDraftAgent",
  );
  if (email) return normalizeWhatsAppText(email.message);

  if (result.sections.length <= 1) {
    return normalizeWhatsAppText(result.response) || "No results found.";
  }

  return result.sections
    .map(
      (section) =>
        `*${normalizeWhatsAppText(section.title)}*\n${normalizeWhatsAppText(section.message)}`,
    )
    .join("\n\n");
}

function fallbackResult(response: string): WhatsAppCommunicationResult {
  return {
    ok: false,
    response,
    intent: "unknown",
    intents: [],
    routedAgents: [],
    sections: [],
  };
}

export async function onWhatsAppMessage(
  message: string,
  userId: string,
  options: WhatsAppCommunicationOptions = {},
): Promise<WhatsAppCommunicationResult> {
  const normalizedMessage = message.replace(/\s+/g, " ").trim();
  if (!normalizedMessage) return fallbackResult(WHATSAPP_EMPTY_MESSAGE);

  const logger = options.logger ?? console;
  try {
    await options.sendTypingIndicator?.(userId);
  } catch (error) {
    logger.error("WhatsApp typing indicator failed:", error);
  }

  try {
    const result = await (options.orchestrator ?? orchestrate)(
      normalizedMessage,
      userId,
    );
    return {
      ...result,
      ok: true,
      response: formatForWhatsApp(result),
    };
  } catch (error) {
    logger.error("WhatsApp orchestration error:", error);
    return fallbackResult(WHATSAPP_ERROR_MESSAGE);
  }
}
