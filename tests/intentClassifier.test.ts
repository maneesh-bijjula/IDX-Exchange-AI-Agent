import assert from "node:assert/strict";
import test from "node:test";

import { classifyIntent } from "../src/intentClassifier.ts";
import { isSemanticPropertyRequest } from "../src/agentRegistry.ts";

test("classifies the handbook example as mixed search and market intent", async () => {
  assert.deepEqual(
    await classifyIntent(
      "Find me affordable homes in Pasadena and tell me whether prices are rising.",
    ),
    { intent: "mixed", intents: ["search", "market"] },
  );
});

test("classifies each specialist route", async () => {
  assert.equal((await classifyIntent("Find condos in Irvine under $900k")).intent, "search");
  assert.equal((await classifyIntent("Show the San Diego market price trend")).intent, "market");
  assert.equal((await classifyIntent("Recommend homes like 33348 Robin Drive")).intent, "recommend");
  assert.equal((await classifyIntent("What does DOM mean?")).intent, "knowledge");
  assert.equal((await classifyIntent("Draft an email from those results")).intent, "email");
});

test("keeps definitional questions out of the market route", async () => {
  assert.deepEqual(await classifyIntent("What is a list-to-close ratio?"), {
    intent: "knowledge",
    intents: ["knowledge"],
  });
});

test("classifies market email requests as mixed", async () => {
  assert.deepEqual(
    await classifyIntent("Draft an email summarizing the Pasadena market"),
    { intent: "mixed", intents: ["market", "email"] },
  );
});

test("classifies a recipient-addressed weekly report as market plus email", async () => {
  assert.deepEqual(
    await classifyIntent(
      "Draft a weekly market report for Irvine to buyer@example.com",
    ),
    { intent: "mixed", intents: ["market", "email"] },
  );
});

test("returns unknown for unrelated requests", async () => {
  assert.deepEqual(await classifyIntent("Tell me a joke"), {
    intent: "unknown",
    intents: [],
  });
});

test("keeps qualitative Week 6 searches under the property-search route", async () => {
  const query = "Find me a charming craftsman with mountain views and character";
  assert.deepEqual(await classifyIntent(query), {
    intent: "search",
    intents: ["search"],
  });
  assert.equal(isSemanticPropertyRequest(query), true);
});

test("routes explicit search resets back to the property agent", async () => {
  assert.deepEqual(await classifyIntent("reset"), {
    intent: "search",
    intents: ["search"],
  });
});
