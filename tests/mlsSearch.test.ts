import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveListingsQuery,
  buildSoldCompsQuery,
  formatListingCard,
  getSoldCompCards,
  searchPropertyCardsFromText,
  type ListingRow,
  type QueryExecutor,
  type SoldRow,
} from "../src/mlsSearch.ts";
import { parsePropertyQuery } from "../src/propertyQueryParser.ts";

test("builds active listing SQL with parameterized filters", async () => {
  const filters = await parsePropertyQuery(
    "Find 4 bed 3 bath homes in Newport Beach under $2.4M with ocean view.",
  );
  const { sql, params } = buildActiveListingsQuery(filters, 2, 5);

  assert.match(sql, /FROM rets_property/);
  assert.match(sql, /WHERE L_Status = \?/);
  assert.match(sql, /AND L_City = \?/);
  assert.match(sql, /AND L_SystemPrice <= \?/);
  assert.match(sql, /AND L_Keyword2 >= \?/);
  assert.match(sql, /AND LM_Dec_3 >= \?/);
  assert.match(sql, /AND L_Type_ = \?/);
  assert.match(sql, /AND ViewYN = \?/);
  assert.match(sql, /LIMIT 5 OFFSET 5/);
  assert.deepEqual(params, [
    "Active",
    "Newport Beach",
    2400000,
    4,
    3,
    "SingleFamilyResidence",
    "True",
  ]);
});

test("includes pool, sqft, and HOA filters when present", async () => {
  const filters = await parsePropertyQuery(
    "2 bedroom condos in Costa Mesa under 750k with 1200 sqft, pool, and HOA under 450.",
  );
  const { sql, params } = buildActiveListingsQuery(filters);

  assert.match(sql, /AND LM_Int2_3 >= \?/);
  assert.match(sql, /AND PoolPrivateYN = \?/);
  assert.match(sql, /AND AssociationFee <= \?/);
  assert.deepEqual(params, [
    "Active",
    "Costa Mesa",
    750000,
    2,
    1200,
    "Condominium",
    "True",
    450,
  ]);
});

test("clamps invalid pagination inputs", async () => {
  const filters = await parsePropertyQuery("Show condos under $600k.");
  const { sql } = buildActiveListingsQuery(filters, -3, 200);

  assert.match(sql, /LIMIT 50 OFFSET 0/);
});

test("keeps potentially unsafe city text out of SQL", async () => {
  const filters = await parsePropertyQuery("Show condos under $600k.");
  filters.city = "Irvine' OR 1=1 --";

  const { sql, params } = buildActiveListingsQuery(filters);

  assert.doesNotMatch(sql, /OR 1=1/);
  assert.equal(params.includes("Irvine' OR 1=1 --"), true);
});

test("builds active listing SQL with only default status filter", async () => {
  const filters = await parsePropertyQuery("What should I look at this weekend?");
  const { sql, params } = buildActiveListingsQuery(filters);

  assert.match(sql, /WHERE L_Status = \?/);
  assert.doesNotMatch(sql, /AND L_City = \?/);
  assert.deepEqual(params, ["Active"]);
});

test("builds sold comps SQL with city and months parameters", () => {
  const { sql, params } = buildSoldCompsQuery("Irvine", 6);

  assert.match(sql, /FROM california_sold/);
  assert.match(sql, /WHERE City = \?/);
  assert.match(sql, /DATE_SUB\(CURDATE\(\), INTERVAL \? MONTH\)/);
  assert.match(sql, /PropertyType = \?/);
  assert.match(sql, /ORDER BY CloseDate DESC/);
  assert.deepEqual(params, ["Irvine", 6, "Residential"]);
});

test("defaults invalid sold comp month windows to 12 months", () => {
  const { params } = buildSoldCompsQuery("Irvine", -4);

  assert.deepEqual(params, ["Irvine", 12, "Residential"]);
});

test("formats active listing rows into property cards", () => {
  const row: ListingRow = {
    L_ListingID: "A100",
    L_DisplayId: "OC-A100",
    L_Address: "123 Harbor View",
    L_City: "Newport Beach",
    L_Zip: "92660",
    price: 2350000,
    beds: 4,
    baths: 3,
    sqft: 2500,
    type: "SingleFamilyResidence",
    status: "Active",
    lat: 33.6,
    lng: -117.8,
    YearBuilt: 1998,
    AssociationFee: 300,
    DaysOnMarket: 12,
    PoolPrivateYN: "True",
    ViewYN: "True",
    FireplaceYN: "False",
    PhotoCount: 28,
    LA1_UserFirstName: "Alex",
    LA1_UserLastName: "Agent",
    LO1_OrganizationName: "IDX Realty",
  };

  assert.deepEqual(formatListingCard(row), {
    id: "A100",
    title: "123 Harbor View",
    location: "Newport Beach, 92660",
    price: 2350000,
    beds: 4,
    baths: 3,
    sqft: 2500,
    type: "SingleFamilyResidence",
    status: "Active",
    highlights: [
      "Built 1998",
      "12 days on market",
      "HOA $300",
      "Private pool",
      "View",
      "28 photos",
    ],
    agent: "Alex Agent",
    office: "IDX Realty",
  });
});

test("formats listing cards with missing optional fields", () => {
  const row: ListingRow = {
    L_ListingID: null,
    L_DisplayId: "DISPLAY-1",
    L_Address: null,
    L_City: "Irvine",
    L_Zip: null,
    price: null,
    beds: null,
    baths: null,
    sqft: null,
    type: null,
    status: "Active",
    lat: null,
    lng: null,
    YearBuilt: null,
    AssociationFee: null,
    DaysOnMarket: null,
    PoolPrivateYN: null,
    ViewYN: null,
    FireplaceYN: null,
    PhotoCount: null,
    LA1_UserFirstName: null,
    LA1_UserLastName: null,
    LO1_OrganizationName: null,
  };

  assert.deepEqual(formatListingCard(row), {
    id: "DISPLAY-1",
    title: "Address unavailable",
    location: "Irvine",
    price: null,
    beds: null,
    baths: null,
    sqft: null,
    type: null,
    status: "Active",
    highlights: [],
    agent: null,
    office: null,
  });
});

test("searches property cards from natural language with injected executor", async () => {
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const executor: QueryExecutor = async <T>(sql: string, params: unknown[] = []) => {
    capturedSql = sql;
    capturedParams = params;
    return [
      {
        L_ListingID: "L1",
        L_DisplayId: "D1",
        L_Address: "10 Main Street",
        L_City: "Irvine",
        L_Zip: "92618",
        price: 1495000,
        beds: 3,
        baths: 2,
        sqft: 1800,
        type: "Condominium",
        status: "Active",
        lat: null,
        lng: null,
        YearBuilt: null,
        AssociationFee: null,
        DaysOnMarket: 4,
        PoolPrivateYN: "True",
        ViewYN: null,
        FireplaceYN: null,
        PhotoCount: 14,
        LA1_UserFirstName: null,
        LA1_UserLastName: null,
        LO1_OrganizationName: "Demo Brokerage",
      },
    ] as T[];
  };

  const cards = await searchPropertyCardsFromText(
    "Show 3-bedroom condos in Irvine under $1.5M with pool.",
    { executor },
  );

  assert.match(capturedSql, /FROM rets_property/);
  assert.deepEqual(capturedParams, [
    "Active",
    "Irvine",
    1500000,
    3,
    "Condominium",
    "True",
  ]);
  assert.equal(cards[0].title, "10 Main Street");
  assert.equal(cards[0].price, 1495000);
});

test("returns formatted sold comp cards with injected executor", async () => {
  const executor: QueryExecutor = async <T>() =>
    [
      {
        ListingKey: "S1",
        UnparsedAddress: "22 Sold Lane",
        City: "Irvine",
        CloseDate: "2026-06-01T00:00:00.000Z",
        ClosePrice: 1200000,
        OriginalListPrice: 1250000,
        ListPrice: 1225000,
        DaysOnMarket: 20,
        BedroomsTotal: 3,
        BathroomsTotalInteger: 2,
        LivingArea: 1700,
        PropertyType: "Residential",
        PropertySubType: "Condominium",
        YearBuilt: 2004,
        ListAgentFullName: "Sam Seller",
        ListOfficeName: "IDX Sold Office",
        BuyerOfficeName: "Buyer Office",
      } satisfies SoldRow,
    ] as T[];

  const cards = await getSoldCompCards("Irvine", 12, executor);

  assert.deepEqual(cards, [
    {
      id: "S1",
      title: "22 Sold Lane",
      closePrice: 1200000,
      closeDate: "2026-06-01",
      beds: 3,
      baths: 2,
      sqft: 1700,
      daysOnMarket: 20,
      office: "IDX Sold Office",
    },
  ]);
});
