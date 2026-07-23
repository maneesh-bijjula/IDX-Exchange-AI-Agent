import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveInventoryCountQuery,
  buildSoldMarketRowsQuery,
  formatMarketSummary,
  getMarketSummary,
  type MarketSoldRow,
} from "../src/marketAnalytics.ts";
import { answerMarketQuestion } from "../src/marketStatisticsAgent.ts";
import { type QueryExecutor } from "../src/mlsSearch.ts";

function soldRow(overrides: Partial<MarketSoldRow>): MarketSoldRow {
  return {
    City: "Irvine",
    PostalCode: "92618",
    CloseDate: "2025-01-15",
    ClosePrice: 1000000,
    ListPrice: 1000000,
    LivingArea: 2000,
    DaysOnMarket: 10,
    PropertyType: "Residential",
    PropertySubType: "SingleFamilyResidence",
    ...overrides,
  };
}

test("builds sold market rows SQL with city, ZIP, property subtype, and safe months", () => {
  const { sql, params } = buildSoldMarketRowsQuery({
    city: "Irvine",
    zip: "92618",
    propertyType: "Condominium",
    months: 18,
  });

  assert.match(sql, /FROM california_sold/);
  assert.match(sql, /PropertyType = \?/);
  assert.match(sql, /CloseDate >= DATE_SUB\(CURDATE\(\), INTERVAL \? MONTH\)/);
  assert.match(sql, /AND City = \?/);
  assert.match(sql, /AND PostalCode = \?/);
  assert.match(sql, /AND PropertySubType = \?/);
  assert.deepEqual(params, ["Residential", 18, "Irvine", "92618", "Condominium"]);
});

test("builds active inventory SQL against rets_property", () => {
  const { sql, params } = buildActiveInventoryCountQuery({ city: "Irvine", zip: "92618" });

  assert.match(sql, /FROM rets_property/);
  assert.match(sql, /WHERE L_Status = \?/);
  assert.match(sql, /AND L_City = \?/);
  assert.match(sql, /AND L_Zip = \?/);
  assert.deepEqual(params, ["Active", "Irvine", "92618"]);
});

test("calculates market summary metrics and trends with injected executor", async () => {
  const rows = [
    soldRow({ CloseDate: "2025-01-15", ClosePrice: 1000000, ListPrice: 1020000, LivingArea: 2000, DaysOnMarket: 20 }),
    soldRow({ CloseDate: "2025-01-20", ClosePrice: 1200000, ListPrice: 1200000, LivingArea: 2400, DaysOnMarket: 10 }),
    soldRow({ CloseDate: "2025-02-10", ClosePrice: 1300000, ListPrice: 1250000, LivingArea: 2600, DaysOnMarket: 5 }),
  ];
  const executor: QueryExecutor = async <T>(sql: string) => {
    if (sql.includes("FROM rets_property")) return [{ activeCount: 6 }] as T[];
    return rows as T[];
  };

  const summary = await getMarketSummary({ city: "Irvine", months: 12, executor });

  assert.equal(summary.soldCount, 3);
  assert.equal(summary.avgClosePrice, 1166667);
  assert.equal(summary.medianClosePrice, 1200000);
  assert.equal(summary.avgPricePerSqft, 500);
  assert.equal(summary.avgDaysOnMarket, 11.7);
  assert.equal(summary.listToClosePct, 100.7);
  assert.equal(summary.inventory.monthsOfSupply, 24);
  assert.equal(summary.monthOverMonthPriceChangePct, 18.2);
  assert.equal(summary.trend.length, 2);
});

test("formats a data-backed market answer", async () => {
  const executor: QueryExecutor = async <T>(sql: string) => {
    if (sql.includes("FROM rets_property")) return [{ activeCount: 4 }] as T[];
    return [
      soldRow({ CloseDate: "2025-01-01", ClosePrice: 900000, ListPrice: 910000, LivingArea: 1800, DaysOnMarket: 8 }),
      soldRow({ CloseDate: "2025-02-01", ClosePrice: 1100000, ListPrice: 1090000, LivingArea: 2200, DaysOnMarket: 12 }),
    ] as T[];
  };

  const result = await answerMarketQuestion("What is the average price per sq ft in Pasadena?", {
    executor,
  });

  assert.equal(result.parsedQuestion.city, "Pasadena");
  assert.match(result.message, /Market snapshot for Pasadena/);
  assert.match(result.message, /Median close price: \$1,000,000/);
  assert.match(result.message, /Average price per sqft: \$500/);
});

test("asks for a city or ZIP when the question has no market", async () => {
  const result = await answerMarketQuestion("How is the market doing?");

  assert.equal(result.summary, null);
  assert.equal(result.message, "Which California city or ZIP should I analyze?");
});

test("formats empty market results clearly", () => {
  const message = formatMarketSummary({
    city: "Nowhere",
    zip: null,
    months: 12,
    soldCount: 0,
    avgClosePrice: null,
    medianClosePrice: null,
    avgPricePerSqft: null,
    avgDaysOnMarket: null,
    listToClosePct: null,
    monthOverMonthPriceChangePct: null,
    yearOverYearPriceChangePct: null,
    inventory: { activeCount: 0, soldCount: 0, monthsOfSupply: null },
    trend: [],
  });

  assert.match(message, /could not find closed residential sales/);
});
