import { parsePropertyQuery, type ParsedPropertyQuery } from "./propertyQueryParser.ts";

export type QueryExecutor = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export type ListingRow = {
  L_ListingID: string | number | null;
  L_DisplayId: string | null;
  L_Address: string | null;
  L_City: string | null;
  L_Zip: string | number | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  status: string | null;
  lat: number | null;
  lng: number | null;
  YearBuilt: number | null;
  AssociationFee: number | null;
  DaysOnMarket: number | null;
  PoolPrivateYN: string | null;
  ViewYN: string | null;
  FireplaceYN: string | null;
  PhotoCount: number | null;
  LA1_UserFirstName: string | null;
  LA1_UserLastName: string | null;
  LO1_OrganizationName: string | null;
};

export type SoldRow = {
  ListingKey: string | number | null;
  UnparsedAddress: string | null;
  City: string | null;
  CloseDate: string | Date | null;
  ClosePrice: number | null;
  OriginalListPrice: number | null;
  ListPrice: number | null;
  DaysOnMarket: number | null;
  BedroomsTotal: number | null;
  BathroomsTotalInteger: number | null;
  LivingArea: number | null;
  PropertyType: string | null;
  PropertySubType: string | null;
  YearBuilt: number | null;
  ListAgentFullName: string | null;
  ListOfficeName: string | null;
  BuyerOfficeName: string | null;
};

export type PropertyCard = {
  id: string | number | null;
  title: string;
  location: string;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  status: string | null;
  highlights: string[];
  agent: string | null;
  office: string | null;
};

export type SoldCompCard = {
  id: string | number | null;
  title: string;
  closePrice: number | null;
  closeDate: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  daysOnMarket: number | null;
  office: string | null;
};

export type SearchOptions = {
  page?: number;
  limit?: number;
  executor?: QueryExecutor;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function normalizePage(page: number): number {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

async function getDefaultExecutor(): Promise<QueryExecutor> {
  const database = await import("./database.ts");
  return database.query;
}

export function buildActiveListingsQuery(
  filters: ParsedPropertyQuery,
  page = 1,
  limit = DEFAULT_LIMIT,
): { sql: string; params: unknown[] } {
  const safePage = normalizePage(page);
  const safeLimit = normalizeLimit(limit);
  const offset = (safePage - 1) * safeLimit;
  const params: unknown[] = [];

  let sql = `
SELECT
  L_ListingID,
  L_DisplayId,
  L_Address,
  L_City,
  L_Zip,
  L_SystemPrice AS price,
  L_Keyword2 AS beds,
  LM_Dec_3 AS baths,
  LM_Int2_3 AS sqft,
  L_Type_ AS type,
  L_Status AS status,
  LMD_MP_Latitude AS lat,
  LMD_MP_Longitude AS lng,
  YearBuilt,
  AssociationFee,
  DaysOnMarket,
  PoolPrivateYN,
  ViewYN,
  FireplaceYN,
  PhotoCount,
  LA1_UserFirstName,
  LA1_UserLastName,
  LO1_OrganizationName
FROM rets_property
WHERE L_Status = ?
`;

  params.push("Active");

  if (filters.city) {
    sql += "  AND L_City = ?\n";
    params.push(filters.city);
  }

  if (filters.maxPrice) {
    sql += "  AND L_SystemPrice <= ?\n";
    params.push(filters.maxPrice);
  }

  if (filters.beds) {
    sql += "  AND L_Keyword2 >= ?\n";
    params.push(filters.beds);
  }

  if (filters.baths) {
    sql += "  AND LM_Dec_3 >= ?\n";
    params.push(filters.baths);
  }

  if (filters.sqft) {
    sql += "  AND LM_Int2_3 >= ?\n";
    params.push(filters.sqft);
  }

  if (filters.type) {
    sql += "  AND L_Type_ = ?\n";
    params.push(filters.type);
  }

  if (filters.pool) {
    sql += "  AND PoolPrivateYN = ?\n";
    params.push(filters.pool);
  }

  if (filters.hasView) {
    sql += "  AND ViewYN = ?\n";
    params.push(filters.hasView);
  }

  if (filters.maxHoa) {
    sql += "  AND AssociationFee <= ?\n";
    params.push(filters.maxHoa);
  }

  sql += `ORDER BY L_SystemPrice ASC LIMIT ${safeLimit} OFFSET ${offset}`;

  return { sql, params };
}

export function buildSoldCompsQuery(
  city: string,
  months = 12,
): { sql: string; params: unknown[] } {
  const safeMonths = Number.isFinite(months) && months > 0 ? Math.floor(months) : 12;
  const sql = `
SELECT
  ListingKey,
  UnparsedAddress,
  City,
  CloseDate,
  ClosePrice,
  OriginalListPrice,
  ListPrice,
  DaysOnMarket,
  BedroomsTotal,
  BathroomsTotalInteger,
  LivingArea,
  PropertyType,
  PropertySubType,
  YearBuilt,
  ListAgentFullName,
  ListOfficeName,
  BuyerOfficeName
FROM california_sold
WHERE City = ?
  AND CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
  AND PropertyType = ?
ORDER BY CloseDate DESC
LIMIT 50`;

  return { sql, params: [city, safeMonths, "Residential"] };
}

export async function searchActiveListings(
  filters: ParsedPropertyQuery,
  options: SearchOptions = {},
): Promise<ListingRow[]> {
  const { sql, params } = buildActiveListingsQuery(
    filters,
    options.page,
    options.limit,
  );
  const executor = options.executor ?? (await getDefaultExecutor());
  return executor<ListingRow>(sql, params);
}

export async function getSoldComps(
  city: string,
  months = 12,
  executor?: QueryExecutor,
): Promise<SoldRow[]> {
  const { sql, params } = buildSoldCompsQuery(city, months);
  const runQuery = executor ?? (await getDefaultExecutor());
  return runQuery<SoldRow>(sql, params);
}

export function formatListingCard(row: ListingRow): PropertyCard {
  const address = row.L_Address ?? "Address unavailable";
  const cityZip = [row.L_City, row.L_Zip].filter(Boolean).join(", ");
  const agentName = [row.LA1_UserFirstName, row.LA1_UserLastName]
    .filter(Boolean)
    .join(" ");

  const highlights = [
    row.YearBuilt ? `Built ${row.YearBuilt}` : null,
    row.DaysOnMarket != null ? `${row.DaysOnMarket} days on market` : null,
    row.AssociationFee != null ? `HOA $${row.AssociationFee}` : null,
    row.PoolPrivateYN === "True" ? "Private pool" : null,
    row.ViewYN === "True" ? "View" : null,
    row.FireplaceYN === "True" ? "Fireplace" : null,
    row.PhotoCount != null ? `${row.PhotoCount} photos` : null,
  ].filter((value): value is string => Boolean(value));

  return {
    id: row.L_ListingID ?? row.L_DisplayId,
    title: address,
    location: cityZip,
    price: row.price,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    type: row.type,
    status: row.status,
    highlights,
    agent: agentName || null,
    office: row.LO1_OrganizationName,
  };
}

export function formatSoldCompCard(row: SoldRow): SoldCompCard {
  return {
    id: row.ListingKey,
    title: row.UnparsedAddress ?? "Address unavailable",
    closePrice: row.ClosePrice,
    closeDate: row.CloseDate ? new Date(row.CloseDate).toISOString().slice(0, 10) : null,
    beds: row.BedroomsTotal,
    baths: row.BathroomsTotalInteger,
    sqft: row.LivingArea,
    daysOnMarket: row.DaysOnMarket,
    office: row.ListOfficeName,
  };
}

export async function searchPropertyCards(
  filters: ParsedPropertyQuery,
  options: SearchOptions = {},
): Promise<PropertyCard[]> {
  const rows = await searchActiveListings(filters, options);
  return rows.map(formatListingCard);
}

export async function searchPropertyCardsFromText(
  queryText: string,
  options: SearchOptions = {},
): Promise<PropertyCard[]> {
  const filters = await parsePropertyQuery(queryText);
  return searchPropertyCards(filters, options);
}

export async function getSoldCompCards(
  city: string,
  months = 12,
  executor?: QueryExecutor,
): Promise<SoldCompCard[]> {
  const rows = await getSoldComps(city, months, executor);
  return rows.map(formatSoldCompCard);
}
