import assert from "node:assert/strict";
import test from "node:test";
import {
  handlePropertySearchMessage,
  type ConversationOptions,
} from "../src/conversationalPropertyAgent.ts";
import type { ListingRow, QueryExecutor } from "../src/mlsSearch.ts";
import {
  clearAllSessions,
  getSession,
  getSessionCount,
} from "../src/userSession.ts";

const sampleRows: ListingRow[] = [
  {
    L_ListingID: "L100",
    L_DisplayId: "D100",
    L_Address: "18 Willow Bend",
    L_City: "Irvine",
    L_Zip: "92618",
    price: 1185000,
    beds: 3,
    baths: 2.5,
    sqft: 1740,
    type: "SingleFamilyResidence",
    status: "Active",
    lat: null,
    lng: null,
    YearBuilt: 1999,
    AssociationFee: 220,
    DaysOnMarket: 8,
    PoolPrivateYN: null,
    ViewYN: "True",
    FireplaceYN: null,
    PhotoCount: 22,
    LA1_UserFirstName: "Jordan",
    LA1_UserLastName: "Lee",
    LO1_OrganizationName: "IDX Realty",
  },
  {
    L_ListingID: "L101",
    L_DisplayId: "D101",
    L_Address: "42 Cypress Grove",
    L_City: "Irvine",
    L_Zip: "92620",
    price: 1199000,
    beds: 3,
    baths: 2,
    sqft: 1605,
    type: "SingleFamilyResidence",
    status: "Active",
    lat: null,
    lng: null,
    YearBuilt: 2003,
    AssociationFee: 180,
    DaysOnMarket: 15,
    PoolPrivateYN: null,
    ViewYN: null,
    FireplaceYN: "True",
    PhotoCount: 17,
    LA1_UserFirstName: "Maya",
    LA1_UserLastName: "Chen",
    LO1_OrganizationName: "Coastal Homes",
  },
];

function createCapturingExecutor(rows: ListingRow[] = sampleRows) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const executor: QueryExecutor = async <T>(sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return rows as T[];
  };

  return { calls, executor };
}

test.beforeEach(() => {
  clearAllSessions();
});

test("asks for budget after capturing city and home type", async () => {
  const response = await handlePropertySearchMessage(
    "user-1",
    "Find homes in Irvine",
  );

  assert.equal(response.askedFor, "collecting_budget");
  assert.match(response.message, /max budget/i);
  assert.equal(response.session.city, "Irvine");
  assert.equal(response.session.type, "SingleFamilyResidence");
  assert.equal(response.session.maxPrice, null);
});

test("runs a search after multiple turns fill required slots", async () => {
  const { calls, executor } = createCapturingExecutor();
  const options: ConversationOptions = { executor, limit: 2 };

  await handlePropertySearchMessage("user-1", "Find homes in Irvine", options);
  await handlePropertySearchMessage("user-1", "Under $1.2M", options);
  const response = await handlePropertySearchMessage(
    "user-1",
    "At least 3 beds",
    options,
  );

  assert.equal(response.askedFor, null);
  assert.equal(response.cards.length, 2);
  assert.match(response.message, /18 Willow Bend/);
  assert.match(response.message, /22 photos/);
  assert.equal(response.session.conversationStep, "showing_results");
  assert.equal(response.session.lastResults.length, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [
    "Active",
    "Irvine",
    1200000,
    3,
    "SingleFamilyResidence",
  ]);
});

test("understands short replies to follow-up questions", async () => {
  const { calls, executor } = createCapturingExecutor();
  const options: ConversationOptions = { executor };

  let response = await handlePropertySearchMessage("user-1", "I want to search", options);
  assert.equal(response.askedFor, "collecting_city");

  response = await handlePropertySearchMessage("user-1", "irvine", options);
  assert.equal(response.askedFor, "collecting_budget");
  assert.equal(response.session.city, "Irvine");

  response = await handlePropertySearchMessage("user-1", "$1.2M", options);
  assert.equal(response.askedFor, "collecting_property_type");
  assert.equal(response.session.maxPrice, 1200000);

  response = await handlePropertySearchMessage("user-1", "single family", options);
  assert.equal(response.askedFor, "collecting_beds");
  assert.equal(response.session.type, "SingleFamilyResidence");

  response = await handlePropertySearchMessage("user-1", "3", options);
  assert.equal(response.askedFor, null);
  assert.equal(response.cards.length, 2);
  assert.deepEqual(calls[0].params, [
    "Active",
    "Irvine",
    1200000,
    3,
    "SingleFamilyResidence",
  ]);
});

test("keeps separate structured sessions per user", async () => {
  await handlePropertySearchMessage("user-irvine", "Find condos in Irvine");
  await handlePropertySearchMessage("user-tustin", "Find townhomes in Tustin");

  assert.equal(getSessionCount(), 2);
  assert.equal(getSession("user-irvine").city, "Irvine");
  assert.equal(getSession("user-irvine").type, "Condominium");
  assert.equal(getSession("user-tustin").city, "Tustin");
  assert.equal(getSession("user-tustin").type, "Townhouse");
});

test("refines an existing search and reruns with the new pool filter", async () => {
  const { calls, executor } = createCapturingExecutor();
  const options: ConversationOptions = { executor };

  await handlePropertySearchMessage("user-1", "Find homes in Irvine under $1.2M with 3 beds", options);
  const response = await handlePropertySearchMessage("user-1", "Add a pool", options);

  assert.equal(response.session.pool, "True");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, [
    "Active",
    "Irvine",
    1200000,
    3,
    "SingleFamilyResidence",
    "True",
  ]);
});

test("reset clears previous search state", async () => {
  const { executor } = createCapturingExecutor();

  await handlePropertySearchMessage("user-1", "Find homes in Irvine under 1M with 3 beds", {
    executor,
  });

  const response = await handlePropertySearchMessage("user-1", "reset");

  assert.equal(response.askedFor, "collecting_city");
  assert.equal(response.session.city, null);
  assert.equal(response.session.maxPrice, null);
  assert.equal(response.session.beds, null);
  assert.match(response.message, /Search reset/i);
});

test("returns a helpful empty-results message", async () => {
  const { executor } = createCapturingExecutor([]);

  const response = await handlePropertySearchMessage(
    "user-1",
    "Find condos in Irvine under $700k with 2 beds",
    { executor },
  );

  assert.equal(response.cards.length, 0);
  assert.match(response.message, /could not find/i);
  assert.equal(response.session.lastResults.length, 0);
});
