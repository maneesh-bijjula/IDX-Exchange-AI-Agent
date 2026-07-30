import { query } from "./database.ts";

export interface SchoolDistrictMapping {
  listingId: string;
  districtName: string;
  districtType: "Unified";
  districtCdsCode: string;
  countyName: string;
  boundaryYear: string;
}

export interface SchoolDistrictQuery {
  sql: string;
  params: unknown[];
}

export type SchoolDistrictExecutor = <T>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export function buildSchoolDistrictLookupQuery(
  listingId: string,
): SchoolDistrictQuery {
  const normalizedListingId = listingId.trim();
  if (!normalizedListingId) {
    throw new Error("A listing ID is required");
  }

  return {
    sql: `
SELECT
  listing_id AS listingId,
  district_name AS districtName,
  district_type AS districtType,
  district_cds_code AS districtCdsCode,
  county_name AS countyName,
  boundary_year AS boundaryYear
FROM property_school_district
WHERE listing_id = ?
  AND matched = 1
LIMIT 1
`.trim(),
    params: [normalizedListingId],
  };
}

export function buildSchoolDistrictBatchLookupQuery(
  listingIds: string[],
): SchoolDistrictQuery {
  const normalizedListingIds = [
    ...new Set(listingIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (normalizedListingIds.length === 0) {
    throw new Error("At least one listing ID is required");
  }

  const placeholders = normalizedListingIds.map(() => "?").join(", ");
  return {
    sql: `
SELECT
  listing_id AS listingId,
  district_name AS districtName,
  district_type AS districtType,
  district_cds_code AS districtCdsCode,
  county_name AS countyName,
  boundary_year AS boundaryYear
FROM property_school_district
WHERE listing_id IN (${placeholders})
  AND matched = 1
`.trim(),
    params: normalizedListingIds,
  };
}

export async function getSchoolDistrictForListing(
  listingId: string,
  executor: SchoolDistrictExecutor = query,
): Promise<SchoolDistrictMapping | null> {
  const { sql, params } = buildSchoolDistrictLookupQuery(listingId);
  const rows = await executor<SchoolDistrictMapping>(sql, params);
  return rows[0] ?? null;
}

export async function getSchoolDistrictsForListings(
  listingIds: string[],
  executor: SchoolDistrictExecutor = query,
): Promise<Map<string, SchoolDistrictMapping>> {
  if (listingIds.every((id) => !id.trim())) return new Map();

  const { sql, params } = buildSchoolDistrictBatchLookupQuery(listingIds);
  const rows = await executor<SchoolDistrictMapping>(sql, params);
  return new Map(rows.map((row) => [row.listingId, row]));
}
