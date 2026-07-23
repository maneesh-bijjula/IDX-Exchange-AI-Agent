export type MarketMetric =
  | "summary"
  | "price_per_sqft"
  | "days_on_market"
  | "list_to_close"
  | "inventory"
  | "trend";

export type ParsedMarketQuestion = {
  city: string | null;
  zip: string | null;
  months: number;
  metric: MarketMetric;
};

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 60;

const CITY_PATTERN =
  /\b(?:in|for|around|near)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})(?=\s+(?:over|during|for|last|past|this|market|price|prices|average|avg|median|dom|days|inventory|sales|sold|trend|trends|sqft|square|zip|under|above)\b|[,.!?]|$)/i;

const COMMAND_CITY_PATTERN =
  /\b(?:show|analyze|analyse|compare|summarize|summarise)\s+(?:me\s+)?(?:the\s+)?([A-Z][A-Za-z]+)(?=\s+(?:market|median|average|avg|price|prices|dom|days|inventory|sales|sold|trend|trends|sqft|square|stats|statistics|summary)\b|[,.!?]|$)/i;

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function parseMonths(question: string): number {
  const explicitMonths = question.match(/\b(?:(?:last|past|over)\s+)?(\d{1,2})\s*(?:months?|mos?)\b/i);
  if (explicitMonths) {
    return Math.min(Math.max(Number(explicitMonths[1]), 1), MAX_MONTHS);
  }

  const explicitYears = question.match(/\b(?:(?:last|past|over)\s+)?(\d{1,2})\s*(?:years?|yrs?)\b/i);
  if (explicitYears) {
    return Math.min(Math.max(Number(explicitYears[1]) * 12, 1), MAX_MONTHS);
  }

  if (/\b(?:year over year|year-over-year|yoy)\b/i.test(question)) return 24;
  if (/\b(?:two years|2 years)\b/i.test(question)) return 24;
  return DEFAULT_MONTHS;
}

function parseMetric(question: string): MarketMetric {
  if (/\b(?:inventory|active count|active listings?|supply)\b/i.test(question)) return "inventory";
  if (/\b(?:price per square foot|price per sq ft|price\/sqft|ppsf|sqft)\b/i.test(question)) {
    return "price_per_sqft";
  }
  if (/\b(?:days on market|dom)\b/i.test(question)) return "days_on_market";
  if (/\b(?:list[-\s]?to[-\s]?close|sale[-\s]?to[-\s]?list|negotiation)\b/i.test(question)) {
    return "list_to_close";
  }
  if (/\b(?:trend|trends|month over month|month-over-month|mom|year over year|year-over-year|yoy)\b/i.test(question)) {
    return "trend";
  }
  return "summary";
}

export function parseMarketQuestion(question: string): ParsedMarketQuestion {
  const cityMatch = question.match(CITY_PATTERN) ?? question.match(COMMAND_CITY_PATTERN);
  const zipMatch = question.match(/\b(?:zip|postal code)?\s*(9\d{4})\b/i);

  return {
    city: cityMatch ? toTitleCase(cityMatch[1]) : null,
    zip: zipMatch ? zipMatch[1] : null,
    months: parseMonths(question),
    metric: parseMetric(question),
  };
}
