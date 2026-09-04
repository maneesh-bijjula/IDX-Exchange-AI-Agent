import { type QueryExecutor } from "./mlsSearch.ts";
import { parseMarketQuestion } from "./marketQuestionParser.ts";

export type WeeklyMarketReportRow = {
  latestCloseDate: string | Date | null;
  currentWeekSales: number | string | null;
  previousWeekSales: number | string | null;
  averageClosePrice: number | string | null;
  averagePricePerSqft: number | string | null;
  averageDaysOnMarket: number | string | null;
  listToClosePct: number | string | null;
};

export type WeeklyMarketReport = {
  city: string;
  periodEnd: string | null;
  currentWeekSales: number;
  previousWeekSales: number;
  salesChangePct: number | null;
  averageClosePrice: number | null;
  averagePricePerSqft: number | null;
  averageDaysOnMarket: number | null;
  listToClosePct: number | null;
};

export type WeeklyMarketReportResponse = {
  message: string;
  report: WeeklyMarketReport | null;
};

export function isWeeklyMarketReportRequest(query: string): boolean {
  return /\bweekly\b[^.!?]{0,40}\bmarket\s+report\b/i.test(query);
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function parseWeeklyReportCity(query: string): string | null {
  const parsed = parseMarketQuestion(query);
  if (parsed.city) return parsed.city;

  const match = query.match(
    /\bweekly\s+(?:real\s+estate\s+)?market\s+report\s+(?:for|in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)(?=\s+(?:to|for)\s+[\w.+-]+@|[,.!?]|$)/i,
  ) ?? query.match(
    /\bweekly\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)\s+market\s+report\b/i,
  );
  return match ? titleCase(match[1]) : null;
}

export function buildWeeklyMarketReportQuery(city: string): {
  sql: string;
  params: unknown[];
} {
  const sql = `
SELECT
  MAX(latest.latestCloseDate) AS latestCloseDate,
  SUM(CASE
    WHEN sold.CloseDate > DATE_SUB(latest.latestCloseDate, INTERVAL 7 DAY) THEN 1
    ELSE 0
  END) AS currentWeekSales,
  SUM(CASE
    WHEN sold.CloseDate > DATE_SUB(latest.latestCloseDate, INTERVAL 14 DAY)
      AND sold.CloseDate <= DATE_SUB(latest.latestCloseDate, INTERVAL 7 DAY)
    THEN 1 ELSE 0
  END) AS previousWeekSales,
  AVG(CASE
    WHEN sold.CloseDate > DATE_SUB(latest.latestCloseDate, INTERVAL 7 DAY)
    THEN sold.ClosePrice
    ELSE NULL
  END) AS averageClosePrice,
  AVG(CASE
    WHEN sold.CloseDate > DATE_SUB(latest.latestCloseDate, INTERVAL 7 DAY)
      AND sold.LivingArea > 0
    THEN sold.ClosePrice / sold.LivingArea
    ELSE NULL
  END) AS averagePricePerSqft,
  AVG(CASE
    WHEN sold.CloseDate > DATE_SUB(latest.latestCloseDate, INTERVAL 7 DAY)
    THEN sold.DaysOnMarket
    ELSE NULL
  END) AS averageDaysOnMarket,
  AVG(CASE
    WHEN sold.CloseDate > DATE_SUB(latest.latestCloseDate, INTERVAL 7 DAY)
      AND sold.ListPrice > 0
    THEN (sold.ClosePrice / sold.ListPrice) * 100
    ELSE NULL
  END) AS listToClosePct
FROM california_sold AS sold
CROSS JOIN (
  SELECT MAX(CloseDate) AS latestCloseDate
  FROM california_sold
  WHERE PropertyType = ?
    AND City = ?
) AS latest
WHERE sold.PropertyType = ?
  AND sold.City = ?
  AND sold.CloseDate > DATE_SUB(latest.latestCloseDate, INTERVAL 14 DAY)
LIMIT 1`;

  return { sql, params: ["Residential", city, "Residential", city] };
}

function numeric(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number | null, digits = 0): number | null {
  if (value == null) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return rounded(((current - previous) / previous) * 100, 1);
}

function money(value: number | null): string {
  return value == null ? "not enough data" : `$${value.toLocaleString("en-US")}`;
}

function metric(value: number | null, suffix: string): string {
  return value == null ? "not enough data" : `${value.toLocaleString("en-US")}${suffix}`;
}

function salesChangeLabel(value: number | null): string {
  if (value == null) return "not enough prior-week data";
  if (value === 0) return "flat from the previous week";
  return `${value > 0 ? "up" : "down"} ${Math.abs(value)}% from the previous week`;
}

function dateLabel(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function defaultExecutor<T>(sql: string, params: unknown[]): Promise<T[]> {
  const database = await import("./database.ts");
  return database.query<T>(sql, params);
}

export async function generateWeeklyMarketReport(
  query: string,
  options: { executor?: QueryExecutor } = {},
): Promise<WeeklyMarketReportResponse> {
  const city = parseWeeklyReportCity(query);
  if (!city) {
    return {
      message: "Which California city should I use for the weekly market report?",
      report: null,
    };
  }

  const built = buildWeeklyMarketReportQuery(city);
  const executor = options.executor ?? defaultExecutor;
  const rows = await executor<WeeklyMarketReportRow>(built.sql, built.params);
  const row = rows[0];
  const currentWeekSales = numeric(row?.currentWeekSales) ?? 0;
  const previousWeekSales = numeric(row?.previousWeekSales) ?? 0;
  const report: WeeklyMarketReport = {
    city,
    periodEnd: dateLabel(row?.latestCloseDate),
    currentWeekSales,
    previousWeekSales,
    salesChangePct: percentChange(currentWeekSales, previousWeekSales),
    averageClosePrice: rounded(numeric(row?.averageClosePrice)),
    averagePricePerSqft: rounded(numeric(row?.averagePricePerSqft), 2),
    averageDaysOnMarket: rounded(numeric(row?.averageDaysOnMarket), 1),
    listToClosePct: rounded(numeric(row?.listToClosePct), 1),
  };

  const message = [
    `Weekly market report for ${city} (latest available 7-day period${report.periodEnd ? ` ending ${report.periodEnd}` : ""}):`,
    `- Closed sales: ${currentWeekSales.toLocaleString("en-US")}`,
    `- Sales activity: ${salesChangeLabel(report.salesChangePct)}`,
    `- Average close price: ${money(report.averageClosePrice)}`,
    `- Average price per sqft: ${money(report.averagePricePerSqft)}`,
    `- Average days on market: ${metric(report.averageDaysOnMarket, " days")}`,
    `- List-to-close ratio: ${metric(report.listToClosePct, "%")}`,
    "- Source: california_sold aggregate analytics",
  ].join("\n");

  return { message, report };
}
