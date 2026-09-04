import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyMarketReportQuery,
  generateWeeklyMarketReport,
  isWeeklyMarketReportRequest,
  parseWeeklyReportCity,
} from "../src/weeklyMarketReport.ts";

test("parses a city from a weekly report email request", () => {
  assert.equal(
    parseWeeklyReportCity(
      "Draft a weekly market report for Irvine to buyer@example.com",
    ),
    "Irvine",
  );
  assert.equal(
    parseWeeklyReportCity("Draft a weekly Irvine market report"),
    "Irvine",
  );
});

test("recognizes both common weekly report word orders", () => {
  assert.equal(isWeeklyMarketReportRequest("Draft a weekly market report for Irvine"), true);
  assert.equal(isWeeklyMarketReportRequest("Draft a weekly Irvine market report"), true);
  assert.equal(isWeeklyMarketReportRequest("Show the Irvine market"), false);
});

test("builds a parameterized aggregate query with a one-row limit", () => {
  const built = buildWeeklyMarketReportQuery("Irvine");

  assert.match(built.sql, /FROM california_sold/);
  assert.match(built.sql, /City = \?/);
  assert.match(built.sql, /LIMIT 1/);
  assert.doesNotMatch(built.sql, /Irvine/);
  assert.deepEqual(built.params, [
    "Residential",
    "Irvine",
    "Residential",
    "Irvine",
  ]);
});

test("generates a formatted seven-day market report from one aggregate row", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const result = await generateWeeklyMarketReport(
    "Prepare a weekly market report for Irvine",
    {
      executor: async <T>(sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return [
          {
            latestCloseDate: "2026-08-31",
            currentWeekSales: 12,
            previousWeekSales: 10,
            averageClosePrice: 1_525_400,
            averagePricePerSqft: 812.345,
            averageDaysOnMarket: 31.24,
            listToClosePct: 99.86,
          },
        ] as T[];
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(result.report?.salesChangePct, 20);
  assert.equal(result.report?.periodEnd, "2026-08-31");
  assert.match(result.message, /Weekly market report for Irvine/);
  assert.match(result.message, /Closed sales: 12/);
  assert.match(result.message, /\$1,525,400/);
  assert.match(result.message, /Source: california_sold/);
});

test("asks for a city before querying", async () => {
  let queried = false;
  const result = await generateWeeklyMarketReport("Draft a weekly market report", {
    executor: async <T>() => {
      queried = true;
      return [] as T[];
    },
  });

  assert.equal(queried, false);
  assert.equal(result.report, null);
  assert.match(result.message, /Which California city/);
});
