import assert from "node:assert/strict";
import test from "node:test";
import { parseMarketQuestion } from "../src/marketQuestionParser.ts";

test("parses city and default 12 month summary intent", () => {
  assert.deepEqual(parseMarketQuestion("Is now a good time to buy in San Diego?"), {
    city: "San Diego",
    zip: null,
    months: 12,
    metric: "summary",
  });
});

test("parses price per sqft metric and city", () => {
  assert.deepEqual(parseMarketQuestion("What is the average price per sq ft in Pasadena?"), {
    city: "Pasadena",
    zip: null,
    months: 12,
    metric: "price_per_sqft",
  });
});

test("parses trend time windows", () => {
  assert.deepEqual(parseMarketQuestion("Show the 24 month trend for Irvine"), {
    city: "Irvine",
    zip: null,
    months: 24,
    metric: "trend",
  });
});

test("parses command-style city before metric words", () => {
  assert.deepEqual(parseMarketQuestion("Show Irvine median price and days on market over the last 12 months"), {
    city: "Irvine",
    zip: null,
    months: 12,
    metric: "days_on_market",
  });
});

test("parses ZIP inventory questions", () => {
  assert.deepEqual(parseMarketQuestion("Inventory in 92618 over the last 6 months"), {
    city: null,
    zip: "92618",
    months: 6,
    metric: "inventory",
  });
});
