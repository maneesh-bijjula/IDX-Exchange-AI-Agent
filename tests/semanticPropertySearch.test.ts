import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatSemanticSearchResults } from "../src/semanticPropertyAgent.ts";
import {
  buildListingEmbeddingText,
  buildSemanticListingIndex,
  buildSemanticListingRowsQuery,
  cosineSimilarity,
  loadSemanticListingIndex,
  mapSemanticListingRow,
  rankSemanticListings,
  saveSemanticListingIndex,
  searchSemanticListings,
  type SemanticListing,
  type SemanticListingIndex,
  type SemanticListingRow,
} from "../src/semanticPropertySearch.ts";
import { type QueryExecutor } from "../src/mlsSearch.ts";

function listing(overrides: Partial<SemanticListing> = {}): SemanticListing {
  return {
    id: "listing-1",
    displayId: "MLS-1",
    address: "10 Canyon Road",
    city: "Pasadena",
    zip: "91103",
    price: 1250000,
    beds: 3,
    baths: 2,
    sqft: 1800,
    type: "SingleFamilyResidence",
    status: "Active",
    yearBuilt: 1924,
    remarks: "Charming craftsman with original details and mountain views.",
    ...overrides,
  };
}

function row(overrides: Partial<SemanticListingRow> = {}): SemanticListingRow {
  return {
    L_ListingID: "listing-1",
    L_DisplayId: "MLS-1",
    L_Address: "10 Canyon Road",
    L_City: "Pasadena",
    L_Zip: "91103",
    L_SystemPrice: 1250000,
    L_Keyword2: 3,
    LM_Dec_3: 2,
    LM_Int2_3: 1800,
    L_Type_: "SingleFamilyResidence",
    L_Status: "Active",
    YearBuilt: 1924,
    L_Remarks: "Charming craftsman with original details and mountain views.",
    ...overrides,
  };
}

function semanticIndex(
  entries: Array<{ listing: SemanticListing; embedding: number[] }>,
): SemanticListingIndex {
  return {
    version: 1,
    model: "test-model",
    dimensions: entries[0]?.embedding.length ?? 0,
    generatedAt: "2026-07-30T00:00:00.000Z",
    listingCount: entries.length,
    listings: entries,
  };
}

test("builds parameterized active listing SQL with remarks and a city filter", () => {
  const { sql, params } = buildSemanticListingRowsQuery({
    limit: 250,
    city: "Pasadena",
  });

  assert.match(sql, /FROM rets_property/);
  assert.match(sql, /WHERE L_Status = \?/);
  assert.match(sql, /L_Remarks IS NOT NULL/);
  assert.match(sql, /TRIM\(L_Remarks\) <> \?/);
  assert.match(sql, /AND L_City = \?/);
  assert.match(sql, /LIMIT 250$/);
  assert.deepEqual(params, ["Active", "", "Pasadena"]);
});

test("maps database values and builds rich listing text", () => {
  const mapped = mapSemanticListingRow(
    row({
      L_SystemPrice: "1250000",
      L_Keyword2: "3",
      L_Remarks: "  Charming\ncraftsman with character.  ",
    }),
  );

  assert.ok(mapped);
  assert.equal(mapped.price, 1250000);
  assert.equal(mapped.beds, 3);
  assert.equal(mapped.remarks, "Charming craftsman with character.");

  const text = buildListingEmbeddingText(mapped);
  assert.match(text, /Property type: SingleFamilyResidence/);
  assert.match(text, /Location: Pasadena, 91103, California/);
  assert.match(text, /Built in 1924/);
  assert.match(text, /Listing description: Charming craftsman/);
});

test("skips rows without an ID or meaningful remarks", () => {
  assert.equal(
    mapSemanticListingRow(
      row({ L_ListingID: null, L_DisplayId: null }),
    ),
    null,
  );
  assert.equal(mapSemanticListingRow(row({ L_Remarks: "   " })), null);
});

test("calculates cosine similarity and handles invalid vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1], [1, 0]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
});

test("ranks the most similar listings first", () => {
  const index = semanticIndex([
    { listing: listing({ id: "coastal" }), embedding: [0, 1] },
    { listing: listing({ id: "craftsman" }), embedding: [1, 0] },
    { listing: listing({ id: "mixed" }), embedding: [0.7, 0.7] },
  ]);

  const results = rankSemanticListings([1, 0], index, 2);

  assert.deepEqual(
    results.map((result) => result.listing.id),
    ["craftsman", "mixed"],
  );
  assert.equal(results[0].score, 1);
});

test("builds an index in batches with injected database and embeddings", async () => {
  const rows = [
    row({ L_ListingID: "1" }),
    row({ L_ListingID: "2" }),
    row({ L_ListingID: "3" }),
  ];
  const executor: QueryExecutor = async <T>() => rows as T[];
  const batchSizes: number[] = [];
  const progress: number[] = [];

  const index = await buildSemanticListingIndex({
    executor,
    batchSize: 2,
    embeddingProvider: async (texts) => {
      batchSizes.push(texts.length);
      return texts.map((_, itemIndex) => [batchSizes.length, itemIndex + 1]);
    },
    onProgress(completed) {
      progress.push(completed);
    },
  });

  assert.equal(index.listingCount, 3);
  assert.deepEqual(batchSizes, [2, 1]);
  assert.deepEqual(progress, [2, 3]);
  assert.deepEqual(index.listings[0].embedding, [1, 1]);
});

test("searches an existing index with one query embedding call", async () => {
  const index = semanticIndex([
    { listing: listing({ id: "best" }), embedding: [1, 0] },
    { listing: listing({ id: "other" }), embedding: [0, 1] },
  ]);
  const inputs: string[][] = [];

  const results = await searchSemanticListings("  mountain\ncraftsman ", {
    index,
    embeddingProvider: async (texts) => {
      inputs.push(texts);
      return [[1, 0]];
    },
  });

  assert.deepEqual(inputs, [["mountain craftsman"]]);
  assert.equal(results[0].listing.id, "best");
});

test("saves and loads a valid semantic index", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "idx-semantic-test-"));
  const indexPath = path.join(directory, "index.json");
  const index = semanticIndex([
    { listing: listing(), embedding: [1, 0] },
  ]);

  try {
    await saveSemanticListingIndex(index, indexPath);
    const loaded = await loadSemanticListingIndex(indexPath);
    assert.deepEqual(loaded, index);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("formats five semantic results as readable property matches", () => {
  const results = Array.from({ length: 5 }, (_, index) => ({
    listing: listing({
      id: `listing-${index + 1}`,
      address: `${index + 1} Character Lane`,
    }),
    score: 1 - index * 0.05,
    schoolDistrict:
      index === 0
        ? {
            listingId: "listing-1",
            districtName: "Example Unified",
            districtType: "Unified" as const,
            districtCdsCode: "123",
            countyName: "Example",
            boundaryYear: "2025-26",
          }
        : null,
  }));

  const message = formatSemanticSearchResults(
    "charming craftsman with character",
    results,
  );

  assert.match(message, /Top 5 semantic matches/);
  assert.match(message, /1\. 1 Character Lane/);
  assert.match(message, /5\. 5 Character Lane/);
  assert.match(message, /100\.0% semantic match/);
  assert.match(message, /School district: Example Unified, Example County/);
  assert.match(message, /School district: Unified district unavailable/);
});
