import {
  searchSemanticListings,
  type SemanticSearchOptions,
  type SemanticSearchResult,
} from "./semanticPropertySearch.ts";
import {
  getSchoolDistrictsForListings,
  type SchoolDistrictExecutor,
  type SchoolDistrictMapping,
} from "./schoolDistrict.ts";

export type SemanticPropertyResponse = {
  message: string;
  query: string;
  results: EnrichedSemanticSearchResult[];
};

export type EnrichedSemanticSearchResult = SemanticSearchResult & {
  schoolDistrict: SchoolDistrictMapping | null;
};

export type SemanticPropertyAgentOptions = SemanticSearchOptions & {
  schoolDistrictExecutor?: SchoolDistrictExecutor;
};

function money(value: number | null): string {
  return value == null ? "Price unavailable" : `$${value.toLocaleString("en-US")}`;
}

function numberLabel(value: number | null, label: string): string | null {
  if (value == null) return null;
  return `${value.toLocaleString("en-US")} ${label}`;
}

function remarksPreview(remarks: string, maxLength = 220): string {
  if (remarks.length <= maxLength) return remarks;
  return `${remarks.slice(0, maxLength - 3).trimEnd()}...`;
}

export function formatSemanticSearchResults(
  query: string,
  results: Array<
    SemanticSearchResult & {
      schoolDistrict?: SchoolDistrictMapping | null;
    }
  >,
): string {
  if (results.length === 0) {
    return `I could not find semantically similar active listings for "${query}". Rebuild the semantic index with more listings and try again.`;
  }

  const formatted = results.map(({ listing, score, schoolDistrict }, index) => {
    const address = listing.address ?? "Address unavailable";
    const location = [listing.city, listing.zip].filter(Boolean).join(", ");
    const facts = [
      numberLabel(listing.beds, listing.beds === 1 ? "bed" : "beds"),
      numberLabel(listing.baths, listing.baths === 1 ? "bath" : "baths"),
      numberLabel(listing.sqft, "sqft"),
    ].filter((value): value is string => value != null);
    const match = `${Math.max(0, score * 100).toFixed(1)}% semantic match`;
    const district = schoolDistrict
      ? `${schoolDistrict.districtName}, ${schoolDistrict.countyName} County`
      : "Unified district unavailable";

    return [
      `${index + 1}. ${address}${location ? ` - ${location}` : ""} - ${money(listing.price)}`,
      `   ${[...facts, match].join(" | ")}`,
      `   School district: ${district}`,
      `   ${remarksPreview(listing.remarks)}`,
    ].join("\n");
  });

  return [
    `Top ${results.length} semantic matches for "${query}":`,
    "",
    ...formatted.flatMap((item, index) =>
      index === formatted.length - 1 ? [item] : [item, ""],
    ),
  ].join("\n");
}

export async function answerSemanticPropertyQuery(
  query: string,
  options: SemanticPropertyAgentOptions = {},
): Promise<SemanticPropertyResponse> {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  if (!normalizedQuery) {
    return {
      message: "Describe the kind of property you want to find.",
      query: normalizedQuery,
      results: [],
    };
  }

  const results = await searchSemanticListings(normalizedQuery, {
    ...options,
    topK: options.topK ?? 5,
  });
  let districtByListingId = new Map<string, SchoolDistrictMapping>();
  try {
    districtByListingId = await getSchoolDistrictsForListings(
      results.map(({ listing }) => listing.id),
      options.schoolDistrictExecutor,
    );
  } catch {
    // Semantic search remains usable before the district enrichment is run.
  }
  const enrichedResults = results.map((result) => ({
    ...result,
    schoolDistrict: districtByListingId.get(result.listing.id) ?? null,
  }));

  return {
    message: formatSemanticSearchResults(normalizedQuery, enrichedResults),
    query: normalizedQuery,
    results: enrichedResults,
  };
}
