import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRecommendationRequest,
  type AgentName,
  type AgentRegistry,
  type AgentResult,
} from "../src/agentRegistry.ts";
import {
  clearOrchestratorMemory,
  getOrchestratorMemory,
  orchestrate,
} from "../src/orchestrator.ts";
import { clearAllSessions, updateSession } from "../src/userSession.ts";

const TITLES: Record<AgentName, string> = {
  propertySearchAgent: "Property Search",
  marketStatsAgent: "Market Statistics",
  recommendationAgent: "Recommendations",
  ragAgent: "Knowledge Answer",
  emailDraftAgent: "Email Draft",
};

function result(agent: AgentName, message = `${agent} response`): AgentResult {
  return { agent, title: TITLES[agent], message };
}

function createRegistry(overrides: Partial<AgentRegistry> = {}): AgentRegistry {
  return {
    propertySearchAgent: async () => result("propertySearchAgent"),
    marketStatsAgent: async () => result("marketStatsAgent"),
    recommendationAgent: async () => result("recommendationAgent"),
    ragAgent: async () => result("ragAgent"),
    emailDraftAgent: async (_query, context) =>
      result(
        "emailDraftAgent",
        `Subject: Draft\n\n${context.sourceSections?.length
          ? context.sourceSections.map((section) => section.message).join("\n")
          : context.previousResponse ?? "empty"}`,
      ),
    ...overrides,
  };
}

test.beforeEach(() => {
  clearAllSessions();
  clearOrchestratorMemory();
});

test("routes single intents to the correct registered agent", async () => {
  const cases: Array<[string, AgentName]> = [
    ["Find homes in Irvine", "propertySearchAgent"],
    ["Show the Irvine market trend", "marketStatsAgent"],
    ["Recommend homes like 33348 Robin Drive", "recommendationAgent"],
    ["What does DOM mean?", "ragAgent"],
  ];

  for (const [query, expectedAgent] of cases) {
    const response = await orchestrate(query, `user-${expectedAgent}`, {
      registry: createRegistry(),
    });
    assert.deepEqual(response.routedAgents, [expectedAgent]);
    assert.equal(response.response, `${expectedAgent} response`);
  }
});

test("runs mixed search and market agents concurrently and merges responses", async () => {
  let active = 0;
  let peakActive = 0;
  const delayed = (agent: AgentName) => async () => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return result(agent);
  };
  const registry = createRegistry({
    propertySearchAgent: delayed("propertySearchAgent"),
    marketStatsAgent: delayed("marketStatsAgent"),
  });

  const response = await orchestrate(
    "Find affordable homes in Pasadena and tell me whether prices are rising",
    "mixed-user",
    { registry },
  );

  assert.equal(response.intent, "mixed");
  assert.deepEqual(response.routedAgents, ["propertySearchAgent", "marketStatsAgent"]);
  assert.equal(peakActive, 2);
  assert.match(response.response, /Property Search\npropertySearchAgent response/);
  assert.match(response.response, /Market Statistics\nmarketStatsAgent response/);
});

test("runs a source agent before producing an email draft", async () => {
  const response = await orchestrate(
    "Draft an email summarizing the Pasadena market",
    "email-user",
    { registry: createRegistry() },
  );

  assert.deepEqual(response.routedAgents, ["marketStatsAgent", "emailDraftAgent"]);
  assert.match(response.response, /^Subject: Draft/);
  assert.match(response.response, /marketStatsAgent response/);
});

test("email-only requests use the previous unified response", async () => {
  const registry = createRegistry();
  await orchestrate("What does DOM mean?", "memory-user", { registry });
  const response = await orchestrate("Draft an email from that answer", "memory-user", {
    registry,
  });

  assert.deepEqual(response.routedAgents, ["emailDraftAgent"]);
  assert.match(response.response, /ragAgent response/);
});

test("routes an unclassified reply through an active property-search session", async () => {
  updateSession("follow-up-user", {
    city: "Irvine",
    conversationStep: "collecting_budget",
    turnCount: 1,
  });
  const response = await orchestrate("1200000", "follow-up-user", {
    registry: createRegistry(),
  });

  assert.equal(response.intent, "search");
  assert.deepEqual(response.routedAgents, ["propertySearchAgent"]);
});

test("resolves ordinal recommendation follow-ups from live session results", () => {
  updateSession("recommendation-follow-up", {
    lastResults: [
      {
        id: "irvine-1",
        title: "14612 Mulberry",
        location: "Irvine, 92606",
        price: 1_049_000,
        beds: 3,
        baths: 2,
        sqft: 1_420,
        type: "SingleFamilyResidence",
        status: "Active",
        highlights: ["Built in 1975", "6 days on market"],
        agent: null,
        office: null,
      },
      {
        id: "irvine-2",
        title: "164 Cherrybrook Lane",
        location: "Irvine, 92618",
        price: 1_180_000,
        beds: 3,
        baths: 3,
        sqft: 1_353,
        type: "SingleFamilyResidence",
        status: "Active",
        highlights: ["Built in 1998"],
        agent: null,
        office: null,
      },
    ],
  });

  const request = resolveRecommendationRequest(
    "Recommend homes similar to the first Irvine listing",
    "recommendation-follow-up",
  );

  assert.equal(request.reference, "14612 Mulberry");
  assert.equal(request.targetListing?.city, "Irvine");
  assert.equal(request.targetListing?.zip, "92606");
  assert.equal(request.targetListing?.yearBuilt, 1975);
});

test("returns the handbook fallback without calling an agent", async () => {
  const response = await orchestrate("Tell me a joke", "unknown-user", {
    registry: createRegistry(),
  });

  assert.equal(response.intent, "unknown");
  assert.deepEqual(response.routedAgents, []);
  assert.match(response.response, /not sure how to help/i);
  assert.equal(getOrchestratorMemory("unknown-user")?.lastIntent, "unknown");
});
