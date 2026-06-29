import assert from "node:assert/strict";
import test from "node:test";
import { parsePropertyQuery } from "../src/propertyQueryParser.ts";

test("parses condos in Irvine under 1.5M with pool", async () => {
  const result = await parsePropertyQuery(
    "Show me 3-bedroom condos in Irvine under $1.5M with a pool.",
  );

  assert.equal(result.city, "Irvine");
  assert.equal(result.beds, 3);
  assert.equal(result.maxPrice, 1500000);
  assert.equal(result.type, "Condominium");
  assert.equal(result.pool, "True");
  assert.deepEqual(result.dbColumnFilters.L_SystemPrice, { lte: 1500000 });
});

test("parses Newport Beach homes with view", async () => {
  const result = await parsePropertyQuery(
    "Find 4 bed 3 bath homes in Newport Beach under $2.4M with ocean view.",
  );

  assert.equal(result.city, "Newport Beach");
  assert.equal(result.beds, 4);
  assert.equal(result.baths, 3);
  assert.equal(result.maxPrice, 2400000);
  assert.equal(result.hasView, "True");
});

test("parses townhomes and square footage", async () => {
  const result = await parsePropertyQuery(
    "Townhomes in Tustin below 900k with at least 1600 sqft.",
  );

  assert.equal(result.city, "Tustin");
  assert.equal(result.type, "Townhouse");
  assert.equal(result.maxPrice, 900000);
  assert.equal(result.sqft, 1600);
});

test("parses HOA limit", async () => {
  const result = await parsePropertyQuery(
    "2 bedroom condos in Costa Mesa under 750k with HOA under 450.",
  );

  assert.equal(result.city, "Costa Mesa");
  assert.equal(result.beds, 2);
  assert.equal(result.maxHoa, 450);
  assert.deepEqual(result.dbColumnFilters.AssociationFee, { lte: 450 });
});

test("parses single family homes", async () => {
  const result = await parsePropertyQuery(
    "Single family homes in Anaheim under $1,000,000 with 3 beds.",
  );

  assert.equal(result.city, "Anaheim");
  assert.equal(result.type, "SingleFamilyResidence");
  assert.equal(result.maxPrice, 1000000);
  assert.equal(result.beds, 3);
});

test("parses land queries", async () => {
  const result = await parsePropertyQuery("Land in Laguna Beach under 2M.");

  assert.equal(result.city, "Laguna Beach");
  assert.equal(result.type, "UnimprovedLand");
  assert.equal(result.maxPrice, 2000000);
});

test("parses bathrooms with decimal value", async () => {
  const result = await parsePropertyQuery(
    "Find houses in Orange with 3 beds and 2.5 baths under 1.2 million.",
  );

  assert.equal(result.city, "Orange");
  assert.equal(result.baths, 2.5);
  assert.equal(result.maxPrice, 1200000);
});

test("parses queries without city", async () => {
  const result = await parsePropertyQuery(
    "Show condos under $600k with pool and view.",
  );

  assert.equal(result.city, null);
  assert.equal(result.type, "Condominium");
  assert.equal(result.pool, "True");
  assert.equal(result.hasView, "True");
});

test("parses compact bedroom and bathroom aliases", async () => {
  const result = await parsePropertyQuery("3 br 2 ba house in Fullerton below 850k.");

  assert.equal(result.city, "Fullerton");
  assert.equal(result.beds, 3);
  assert.equal(result.baths, 2);
  assert.equal(result.type, "SingleFamilyResidence");
});

test("parses max price wording", async () => {
  const result = await parsePropertyQuery(
    "Properties in Mission Viejo up to $1.1M with 2000 square feet.",
  );

  assert.equal(result.city, "Mission Viejo");
  assert.equal(result.maxPrice, 1100000);
  assert.equal(result.sqft, 2000);
});

test("parses minimum square feet with property type", async () => {
  const result = await parsePropertyQuery(
    "Show me homes in Huntington Beach under 1.8M at least 2500 sq ft.",
  );

  assert.equal(result.city, "Huntington Beach");
  assert.equal(result.type, "SingleFamilyResidence");
  assert.equal(result.maxPrice, 1800000);
  assert.equal(result.sqft, 2500);
});

test("returns empty filters for unsupported query", async () => {
  const result = await parsePropertyQuery("What should I look at this weekend?");

  assert.deepEqual(result, {
    city: null,
    maxPrice: null,
    beds: null,
    baths: null,
    sqft: null,
    type: null,
    pool: null,
    hasView: null,
    maxHoa: null,
    dbColumnFilters: {},
  });
});
