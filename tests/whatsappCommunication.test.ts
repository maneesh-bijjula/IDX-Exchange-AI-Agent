import assert from "node:assert/strict";
import test from "node:test";

import type { AgentResult } from "../src/agentRegistry.ts";
import type { OrchestratorResponse } from "../src/orchestrator.ts";
import {
  formatForWhatsApp,
  onWhatsAppMessage,
  WHATSAPP_EMPTY_MESSAGE,
  WHATSAPP_ERROR_MESSAGE,
} from "../src/whatsappCommunication.ts";

function section(
  agent: AgentResult["agent"],
  title: string,
  message: string,
): AgentResult {
  return { agent, title, message };
}

function response(sections: AgentResult[]): OrchestratorResponse {
  return {
    response: sections.map((item) => item.message).join("\n\n"),
    intent: sections.length > 1 ? "mixed" : "search",
    intents: sections.length > 1 ? ["search", "market"] : ["search"],
    routedAgents: sections.map((item) => item.agent),
    sections,
  };
}

test("formats a single agent response for WhatsApp", () => {
  const result = response([
    section(
      "propertySearchAgent",
      "Property Search",
      "**1911 N Summit**\n[View Photos](#)\n\n\n$750,000",
    ),
  ]);

  assert.equal(
    formatForWhatsApp(result),
    "*1911 N Summit*\nView Photos\n\n$750,000",
  );
});

test("labels each specialist section in a mixed WhatsApp response", () => {
  const result = response([
    section("propertySearchAgent", "Property Search", "Three active listings"),
    section("marketStatsAgent", "Market Statistics", "Prices are rising"),
  ]);

  assert.equal(
    formatForWhatsApp(result),
    "*Property Search*\nThree active listings\n\n*Market Statistics*\nPrices are rising",
  );
});

test("returns an email draft directly instead of repeating source sections", () => {
  const result = response([
    section("propertySearchAgent", "Property Search", "Three listings"),
    section("emailDraftAgent", "Email Draft", "Subject: Pasadena Homes\n\nHi,"),
  ]);

  assert.equal(formatForWhatsApp(result), "Subject: Pasadena Homes\n\nHi,");
});

test("starts typing before orchestration and returns formatted metadata", async () => {
  const order: string[] = [];
  const source = response([
    section("ragAgent", "Knowledge Answer", "DOM means days on market."),
  ]);

  const result = await onWhatsAppMessage("  What does DOM mean?  ", "user-1", {
    sendTypingIndicator: async (userId) => {
      order.push(`typing:${userId}`);
    },
    orchestrator: async (message, userId) => {
      order.push(`orchestrate:${userId}:${message}`);
      return source;
    },
  });

  assert.deepEqual(order, [
    "typing:user-1",
    "orchestrate:user-1:What does DOM mean?",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.response, "DOM means days on market.");
  assert.deepEqual(result.routedAgents, ["ragAgent"]);
});

test("typing failures do not prevent a WhatsApp response", async () => {
  const errors: string[] = [];
  const result = await onWhatsAppMessage("Find homes in Irvine", "user-2", {
    sendTypingIndicator: async () => {
      throw new Error("typing unavailable");
    },
    logger: {
      error(message) {
        errors.push(message);
      },
    },
    orchestrator: async () =>
      response([
        section("propertySearchAgent", "Property Search", "What is your budget?"),
      ]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.response, "What is your budget?");
  assert.deepEqual(errors, ["WhatsApp typing indicator failed:"]);
});

test("returns deterministic user-facing messages for invalid input and failures", async () => {
  const empty = await onWhatsAppMessage("   ", "user-3");
  assert.equal(empty.ok, false);
  assert.equal(empty.response, WHATSAPP_EMPTY_MESSAGE);

  const failed = await onWhatsAppMessage("Show Irvine homes", "user-3", {
    logger: { error() {} },
    orchestrator: async () => {
      throw new Error("database offline");
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.response, WHATSAPP_ERROR_MESSAGE);
});
