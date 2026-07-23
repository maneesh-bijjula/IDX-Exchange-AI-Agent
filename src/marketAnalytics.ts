import { type QueryExecutor } from "./mlsSearch.ts";

export type MarketAnalyticsOptions = {
  city?: string | null;
  zip?: string | null;
  propertyType?: string | null;
  months?: number;
  executor?: QueryExecutor;
};

export type MarketSoldRow = {
  City: string | null;
  PostalCode: string | number | null;
  CloseDate: string | Date | null;
  ClosePrice: number | null;
  ListPrice: number | null;
  LivingArea: number | null;
  DaysOnMarket: number | null;
  PropertyType: string | null;
  PropertySubType: string | null;
};

export type InventoryComparison = {
  activeCount: number;
  soldCount: number;
  monthsOfSupply: number | null;
};

export type MarketTrendPoint = {
  month: string;
  sales: number;
  avgClosePrice: number | null;
  medianClosePrice: number | null;
  avgPricePerSqft: number | null;
  avgDaysOnMarket: number | null;
  listToClosePct: number | null;
  priceChangePct: number | null;
};

export type MarketSummary = {
  city: string | null;
  zip: string | null;
  months: number;
  soldCount: number;
  avgClosePrice: number | null;
  medianClosePrice: number | null;
  avgPricePerSqft: number | null;
  avgDaysOnMarket: number | null;
  listToClosePct: number | null;
  monthOverMonthPriceChangePct: number | null;
  yearOverYearPriceChangePct: number | null;
  inventory: InventoryComparison;
  trend: MarketTrendPoint[];
};

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 60;

function normalizeMonths(months?: number): number {
  if (!Number.isFinite(months) || months == null || months <= 0) return DEFAULT_MONTHS;
  return Math.min(Math.floor(months), MAX_MONTHS);
}

async function getDefaultExecutor(): Promise<QueryExecutor> {
  const database = await import("./database.ts");
  return database.query;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value: number | null, digits = 0): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function numeric(value: number | string | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthKey(value: string | Date | null): string | null {
  if (!value) return null;
  const dateText = value instanceof Date ? value.toISOString() : String(value);
  const match = dateText.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function buildSoldMarketRowsQuery(
  options: MarketAnalyticsOptions = {},
): { sql: string; params: unknown[] } {
  const months = normalizeMonths(options.months);
  const params: unknown[] = ["Residential", months];

  let sql = `
SELECT
  City,
  PostalCode,
  CloseDate,
  ClosePrice,
  ListPrice,
  LivingArea,
  DaysOnMarket,
  PropertyType,
  PropertySubType
FROM california_sold
WHERE PropertyType = ?
  AND CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
  AND ClosePrice IS NOT NULL
`;

  if (options.city) {
    sql += "  AND City = ?\n";
    params.push(options.city);
  }

  if (options.zip) {
    sql += "  AND PostalCode = ?\n";
    params.push(options.zip);
  }

  if (options.propertyType) {
    sql += "  AND PropertySubType = ?\n";
    params.push(options.propertyType);
  }

  sql += "ORDER BY CloseDate ASC";
  return { sql, params };
}

export function buildActiveInventoryCountQuery(
  options: Pick<MarketAnalyticsOptions, "city" | "zip" | "propertyType"> = {},
): { sql: string; params: unknown[] } {
  const params: unknown[] = ["Active"];

  let sql = `
SELECT COUNT(*) AS activeCount
FROM rets_property
WHERE L_Status = ?
`;

  if (options.city) {
    sql += "  AND L_City = ?\n";
    params.push(options.city);
  }

  if (options.zip) {
    sql += "  AND L_Zip = ?\n";
    params.push(options.zip);
  }

  if (options.propertyType) {
    sql += "  AND L_Type_ = ?\n";
    params.push(options.propertyType);
  }

  return { sql, params };
}

function buildTrend(rows: MarketSoldRow[]): MarketTrendPoint[] {
  const grouped = new Map<string, MarketSoldRow[]>();

  for (const row of rows) {
    const key = monthKey(row.CloseDate);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  let previousAvgPrice: number | null = null;
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, monthRows]) => {
      const closePrices = monthRows.map((row) => numeric(row.ClosePrice)).filter((value): value is number => value != null);
      const pricePerSqft = monthRows
        .map((row) => {
          const closePrice = numeric(row.ClosePrice);
          const sqft = numeric(row.LivingArea);
          return closePrice != null && sqft != null && sqft > 0 ? closePrice / sqft : null;
        })
        .filter((value): value is number => value != null);
      const daysOnMarket = monthRows.map((row) => numeric(row.DaysOnMarket)).filter((value): value is number => value != null);
      const ratios = monthRows
        .map((row) => {
          const closePrice = numeric(row.ClosePrice);
          const listPrice = numeric(row.ListPrice);
          return closePrice != null && listPrice != null && listPrice > 0 ? (closePrice / listPrice) * 100 : null;
        })
        .filter((value): value is number => value != null);
      const avgClosePrice = average(closePrices);
      const point: MarketTrendPoint = {
        month,
        sales: monthRows.length,
        avgClosePrice: round(avgClosePrice),
        medianClosePrice: round(median(closePrices)),
        avgPricePerSqft: round(average(pricePerSqft), 2),
        avgDaysOnMarket: round(average(daysOnMarket), 1),
        listToClosePct: round(average(ratios), 1),
        priceChangePct: round(pctChange(avgClosePrice, previousAvgPrice), 1),
      };
      previousAvgPrice = avgClosePrice;
      return point;
    });
}

function pickYearOverYearChange(trend: MarketTrendPoint[]): number | null {
  if (trend.length < 13) return null;
  const latest = trend[trend.length - 1]?.avgClosePrice ?? null;
  const priorYear = trend[trend.length - 13]?.avgClosePrice ?? null;
  return round(pctChange(latest, priorYear), 1);
}

export async function getMarketSummary(
  options: MarketAnalyticsOptions = {},
): Promise<MarketSummary> {
  const months = normalizeMonths(options.months);
  const executor = options.executor ?? (await getDefaultExecutor());
  const soldQuery = buildSoldMarketRowsQuery({ ...options, months });
  const activeQuery = buildActiveInventoryCountQuery(options);
  const rows = await executor<MarketSoldRow>(soldQuery.sql, soldQuery.params);
  const activeRows = await executor<{ activeCount: number | string }>(activeQuery.sql, activeQuery.params);

  const closePrices = rows.map((row) => numeric(row.ClosePrice)).filter((value): value is number => value != null);
  const pricePerSqft = rows
    .map((row) => {
      const closePrice = numeric(row.ClosePrice);
      const sqft = numeric(row.LivingArea);
      return closePrice != null && sqft != null && sqft > 0 ? closePrice / sqft : null;
    })
    .filter((value): value is number => value != null);
  const daysOnMarket = rows.map((row) => numeric(row.DaysOnMarket)).filter((value): value is number => value != null);
  const ratios = rows
    .map((row) => {
      const closePrice = numeric(row.ClosePrice);
      const listPrice = numeric(row.ListPrice);
      return closePrice != null && listPrice != null && listPrice > 0 ? (closePrice / listPrice) * 100 : null;
    })
    .filter((value): value is number => value != null);
  const trend = buildTrend(rows);
  const latestTrend = trend[trend.length - 1];
  const activeCount = numeric(activeRows[0]?.activeCount) ?? 0;
  const monthlySoldRate = rows.length / months;

  return {
    city: options.city ?? null,
    zip: options.zip ?? null,
    months,
    soldCount: rows.length,
    avgClosePrice: round(average(closePrices)),
    medianClosePrice: round(median(closePrices)),
    avgPricePerSqft: round(average(pricePerSqft), 2),
    avgDaysOnMarket: round(average(daysOnMarket), 1),
    listToClosePct: round(average(ratios), 1),
    monthOverMonthPriceChangePct: latestTrend?.priceChangePct ?? null,
    yearOverYearPriceChangePct: pickYearOverYearChange(trend),
    inventory: {
      activeCount,
      soldCount: rows.length,
      monthsOfSupply: monthlySoldRate > 0 ? round(activeCount / monthlySoldRate, 1) : null,
    },
    trend,
  };
}

function money(value: number | null): string {
  return value == null ? "not enough data" : `$${value.toLocaleString("en-US")}`;
}

function numberLabel(value: number | null, suffix = ""): string {
  return value == null ? "not enough data" : `${value.toLocaleString("en-US")}${suffix}`;
}

function trendLabel(value: number | null): string {
  if (value == null) return "not enough data";
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return `${direction} ${Math.abs(value).toLocaleString("en-US")}%`;
}

export function formatMarketSummary(summary: MarketSummary): string {
  const marketLabel = summary.city ?? (summary.zip ? `ZIP ${summary.zip}` : "the selected market");
  if (summary.soldCount === 0) {
    return `I could not find closed residential sales for ${marketLabel} in the last ${summary.months} months. Try another city, ZIP, or a longer time window.`;
  }

  return [
    `Market snapshot for ${marketLabel} over the last ${summary.months} months:`,
    `- Closed sales: ${summary.soldCount.toLocaleString("en-US")}`,
    `- Median close price: ${money(summary.medianClosePrice)}`,
    `- Average close price: ${money(summary.avgClosePrice)}`,
    `- Average price per sqft: ${money(summary.avgPricePerSqft)}`,
    `- Average days on market: ${numberLabel(summary.avgDaysOnMarket, " days")}`,
    `- List-to-close ratio: ${numberLabel(summary.listToClosePct, "%")}`,
    `- Active vs sold inventory: ${summary.inventory.activeCount.toLocaleString("en-US")} active / ${summary.soldCount.toLocaleString("en-US")} sold (${numberLabel(summary.inventory.monthsOfSupply, " months of supply")})`,
    `- Latest month-over-month average price trend: ${trendLabel(summary.monthOverMonthPriceChangePct)}`,
    `- Year-over-year average price trend: ${trendLabel(summary.yearOverYearPriceChangePct)}`,
  ].join("\n");
}
