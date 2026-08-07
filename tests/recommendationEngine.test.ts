import assert from "node:assert/strict";
import test from "node:test";

import { formatRecommendationResponse } from "../src/recommendationAgent.ts";
import {
  buildCompValidationQuery,
  buildRecommendationCompRowsQuery,
  calculateHybridScore,
  createCompValidation,
  findTargetListing,
  rankHybridRecommendations,
  recommendSimilarListings,
} from "../src/recommendationEngine.ts";
import {
  type SemanticListing,
  type SemanticListingIndex,
} from "../src/semanticPropertySearch.ts";

function listing(overrides: Partial<SemanticListing> = {}): SemanticListing {
  return {
    id: "target",
    displayId: "MLS-TARGET",
    address: "10 Canyon Road",
    city: "Pasadena",
    zip: "91103",
    price: 1_000_000,
    beds: 3,
    baths: 2,
    sqft: 1_800,
    type: "SingleFamilyResidence",
    status: "Active",
    yearBuilt: 1924,
    remarks: "Charming craftsman with original details.",
    ...overrides,
  };
}

function index(): SemanticListingIndex {
  const entries = [
    { listing: listing(), embedding: [1, 0] },
    {
      listing: listing({
        id: "best",
        displayId: "MLS-BEST",
        address: "12 Canyon Road",
        price: 1_040_000,
        sqft: 1_950,
      }),
      embedding: [1, 0],
    },
    {
      listing: listing({
        id: "semantic-only",
        displayId: "MLS-SEM",
        address: "20 Coast Road",
        city: "Malibu",
        price: 1_500_000,
        beds: 5,
        sqft: 3_000,
      }),
      embedding: [0.9, 0.1],
    },
  ];
  return {
    version: 1,
    model: "test-model",
    dimensions: 2,
    generatedAt: "2026-08-07T00:00:00.000Z",
    listingCount: entries.length,
    listings: entries,
  };
}

test("calculates the handbook 60/40 hybrid score", () => {
  const score = calculateHybridScore(
    listing(),
    listing({ price: 1_040_000, sqft: 1_950 }),
    [1, 0],
    [1, 0],
  );

  assert.equal(score.pricePoints, 20);
  assert.equal(score.bedsPoints, 15);
  assert.equal(score.cityPoints, 15);
  assert.equal(score.sqftPoints, 10);
  assert.equal(score.structuredScore, 60);
  assert.equal(score.semanticScore, 40);
  assert.equal(score.totalScore, 100);
});

test("uses the handbook price and square-footage score bands", () => {
  const score = calculateHybridScore(
    listing(),
    listing({ price: 1_149_999, beds: 4, city: "Malibu", sqft: 2_499 }),
    [1, 0],
    [0, 1],
  );

  assert.equal(score.pricePoints, 12);
  assert.equal(score.sqftPoints, 5);
  assert.equal(score.structuredScore, 17);
  assert.equal(score.semanticScore, 0);
});

test("finds a target by ID, exact address, or natural-language address", () => {
  const semanticIndex = index();
  assert.equal(findTargetListing(semanticIndex, "MLS-TARGET")?.listing.id, "target");
  assert.equal(findTargetListing(semanticIndex, "10 Canyon Road")?.listing.id, "target");
  assert.equal(
    findTargetListing(semanticIndex, "recommend homes like 10 Canyon Road")?.listing.id,
    "target",
  );
  assert.equal(findTargetListing(semanticIndex, "missing"), null);
});

test("ranks the strongest hybrid candidate and excludes the target", () => {
  const semanticIndex = index();
  const target = semanticIndex.listings[0];
  const ranked = rankHybridRecommendations(target, semanticIndex, 2);

  assert.deepEqual(
    ranked.map((result) => result.listing.id),
    ["best", "semantic-only"],
  );
  assert.equal(ranked[0].score.totalScore, 100);
});

test("builds parameterized six-month sold-comp SQL", () => {
  const built = buildCompValidationQuery("Pasadena", 2_000);

  assert.match(built.sql, /FROM california_sold/);
  assert.match(built.sql, /City = \?/);
  assert.match(built.sql, /LivingArea BETWEEN \? AND \?/);
  assert.match(built.sql, /INTERVAL \? MONTH/);
  assert.deepEqual(built.params, ["Pasadena", "Residential", 1_600, 2_400, 6]);
  assert.doesNotMatch(built.sql, /Pasadena/);
});

test("builds one parameterized comp query for all recommendations", () => {
  const built = buildRecommendationCompRowsQuery([
    listing(),
    listing({ id: "second", city: "Malibu", sqft: 2_000 }),
  ]);

  assert.ok(built);
  assert.equal((built.sql.match(/FROM california_sold/g) ?? []).length, 1);
  assert.equal((built.sql.match(/City = \?/g) ?? []).length, 2);
  assert.deepEqual(built.params, [
    "Residential",
    6,
    "Pasadena",
    1_440,
    2_160,
    "Malibu",
    1_600,
    2_400,
  ]);
});

test("creates above, below, and unavailable comp assessments", () => {
  const above = createCompValidation(listing(), {
    averagePricePerSqft: 500,
    compCount: 12,
  });
  const below = createCompValidation(listing({ price: 800_000 }), {
    averagePricePerSqft: 500,
    compCount: 12,
  });
  const unavailable = createCompValidation(listing());

  assert.equal(above.estimatedCompPrice, 900_000);
  assert.equal(above.deltaPct, 11.1);
  assert.equal(above.assessment, "11.1% above recent comps");
  assert.equal(above.confidence, "medium");
  assert.equal(below.assessment, "11.1% below recent comps");
  assert.equal(unavailable.confidence, "unavailable");
  assert.equal(unavailable.assessment, "Not enough recent sold-comp data");
});

test("runs ranking and comp validation with an injected executor", async () => {
  const calls: unknown[][] = [];
  const executor = async <T>(_sql: string, params: unknown[] = []) => {
    calls.push(params);
    return [
      { City: "Pasadena", ClosePrice: 1_023_750, LivingArea: 1_950 },
      { City: "Pasadena", ClosePrice: 945_000, LivingArea: 1_800 },
    ] as T[];
  };
  const response = await recommendSimilarListings("10 Canyon Road", {
    index: index(),
    topK: 1,
    executor,
  });

  assert.equal(response.target.id, "target");
  assert.equal(response.recommendations[0].listing.id, "best");
  assert.equal(response.recommendations[0].compValidation.compCount, 2);
  assert.deepEqual(calls[0], ["Residential", 6, "Pasadena", 1_560, 2_340]);
});

test("formats five recommendations with scores and comp evidence", () => {
  const target = listing();
  const recommendations = Array.from({ length: 5 }, (_, itemIndex) => ({
    listing: listing({
      id: `result-${itemIndex}`,
      address: `${itemIndex + 1} Similar Lane`,
    }),
    score: calculateHybridScore(target, target, [1, 0], [1, 0]),
    compValidation: createCompValidation(target, {
      averagePricePerSqft: 500,
      compCount: 12,
    }),
  }));

  const message = formatRecommendationResponse({ target, recommendations });
  assert.match(message, /Top 5 recommendations similar to 10 Canyon Road/);
  assert.match(message, /Hybrid score: 100\/100/);
  assert.match(message, /Why it matches: \$0 price difference; same bedroom count; same city/);
  assert.match(message, /Market evidence: \$900,000 estimate from 12 recent sales/);
  assert.match(message, /11.1% above recent comps; medium confidence/);
  assert.match(message, /informational estimates, not appraisals/);
  assert.match(message, /5\. 5 Similar Lane/);
});
