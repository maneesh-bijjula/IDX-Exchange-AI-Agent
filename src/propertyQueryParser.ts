export type PropertyType =
  | "Condominium"
  | "Townhouse"
  | "SingleFamilyResidence"
  | "UnimprovedLand";

export type ParsedPropertyQuery = {
  city: string | null;
  maxPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: PropertyType | null;
  pool: "True" | null;
  hasView: "True" | null;
  maxHoa: number | null;
  dbColumnFilters: {
    L_City?: string;
    L_SystemPrice?: { lte: number };
    L_Keyword2?: { gte: number };
    LM_Dec_3?: { gte: number };
    LM_Int2_3?: { gte: number };
    L_Type_?: PropertyType;
    PoolPrivateYN?: "True";
    ViewYN?: "True";
    AssociationFee?: { lte: number };
  };
};

const CITY_PATTERN =
  /\b(?:in|near|around|within)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})(?=\s+(?:under|below|less|with|and|at|up|over|above|minimum|min|priced|for|condo|condos|townhome|townhomes|house|houses|single|land|lot|lots)\b|[,.!?]|$)/i;

const TYPE_ALIASES: Array<[RegExp, PropertyType]> = [
  [/\b(condo|condos|condominium|condominiums)\b/i, "Condominium"],
  [/\b(townhome|townhomes|townhouse|townhouses)\b/i, "Townhouse"],
  [/\b(single[-\s]?family|house|houses|home|homes)\b/i, "SingleFamilyResidence"],
  [/\b(land|lot|lots)\b/i, "UnimprovedLand"],
];

function parseMoneyAmount(rawAmount: string, rawSuffix?: string): number {
  const amount = Number(rawAmount.replace(/,/g, ""));
  const suffix = rawSuffix?.toLowerCase();

  if (suffix === "m" || suffix === "million") {
    return Math.round(amount * 1_000_000);
  }

  if (suffix === "k" || suffix === "thousand") {
    return Math.round(amount * 1_000);
  }

  return Math.round(amount);
}

function firstNumber(query: string, pattern: RegExp): number | null {
  const match = query.match(pattern);
  return match ? Number(match[1]) : null;
}

function parseMaxPrice(query: string): number | null {
  const priceMatch = query.match(
    /\b(?:under|below|less than|up to|max(?:imum)?|priced under|price under)\s+\$?\s*([\d,.]+)\s*(m|million|k|thousand)?\b/i,
  );

  if (!priceMatch) return null;
  return parseMoneyAmount(priceMatch[1], priceMatch[2]);
}

function parseMaxHoa(query: string): number | null {
  const hoaMatch = query.match(
    /\b(?:hoa|association fee|association fees)\s*(?:under|below|less than|up to|max(?:imum)?)?\s*\$?\s*([\d,.]+)\b/i,
  );

  if (!hoaMatch) return null;
  return Math.round(Number(hoaMatch[1].replace(/,/g, "")));
}

function parseCity(query: string): string | null {
  const match = query.match(CITY_PATTERN);
  if (!match) return null;

  return match[1]
    .trim()
    .replace(/\bCa\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePropertyType(query: string): PropertyType | null {
  const match = TYPE_ALIASES.find(([pattern]) => pattern.test(query));
  return match ? match[1] : null;
}

export async function parsePropertyQuery(
  query: string,
): Promise<ParsedPropertyQuery> {
  const city = parseCity(query);
  const maxPrice = parseMaxPrice(query);
  const beds = firstNumber(query, /\b(\d+(?:\.\d+)?)\s*(?:[-+]?\s*)?(?:bed|beds|bedroom|bedrooms|br)\b/i);
  const baths = firstNumber(query, /\b(\d+(?:\.\d+)?)\s*(?:[-+]?\s*)?(?:bath|baths|bathroom|bathrooms|ba)\b/i);
  const sqft = firstNumber(query, /\b(\d{3,5})\s*(?:[-+]?\s*)?(?:sq\s*ft|sqft|square feet|sf)\b/i);
  const type = parsePropertyType(query);
  const pool = /\bpool\b/i.test(query) ? "True" : null;
  const hasView = /\b(view|views|ocean view|city view|mountain view)\b/i.test(query)
    ? "True"
    : null;
  const maxHoa = parseMaxHoa(query);

  const dbColumnFilters: ParsedPropertyQuery["dbColumnFilters"] = {};

  if (city) dbColumnFilters.L_City = city;
  if (maxPrice) dbColumnFilters.L_SystemPrice = { lte: maxPrice };
  if (beds) dbColumnFilters.L_Keyword2 = { gte: beds };
  if (baths) dbColumnFilters.LM_Dec_3 = { gte: baths };
  if (sqft) dbColumnFilters.LM_Int2_3 = { gte: sqft };
  if (type) dbColumnFilters.L_Type_ = type;
  if (pool) dbColumnFilters.PoolPrivateYN = pool;
  if (hasView) dbColumnFilters.ViewYN = hasView;
  if (maxHoa) dbColumnFilters.AssociationFee = { lte: maxHoa };

  return {
    city,
    maxPrice,
    beds,
    baths,
    sqft,
    type,
    pool,
    hasView,
    maxHoa,
    dbColumnFilters,
  };
}
