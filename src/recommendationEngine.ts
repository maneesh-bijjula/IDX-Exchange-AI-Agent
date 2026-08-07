import { type QueryExecutor } from "./mlsSearch.ts";
import {
  cosineSimilarity,
  loadSemanticListingIndex,
  type IndexedSemanticListing,
  type SemanticListing,
  type SemanticListingIndex,
} from "./semanticPropertySearch.ts";

export type HybridScore = {
  pricePoints: number;
  bedsPoints: number;
  cityPoints: number;
  sqftPoints: number;
  structuredScore: number;
  semanticSimilarity: number;
  semanticScore: number;
  totalScore: number;
};

export type CompValidation = {
  compCount: number;
  confidence: "high" | "medium" | "low" | "unavailable";
  averagePricePerSqft: number | null;
  estimatedCompPrice: number | null;
  listPrice: number | null;
  deltaPct: number | null;
  assessment: string;
};

export type RecommendationResult = {
  listing: SemanticListing;
  score: HybridScore;
  compValidation: CompValidation;
};

export type RecommendationResponse = {
  target: SemanticListing;
  recommendations: RecommendationResult[];
};

export type RecommendationOptions = {
  topK?: number;
  index?: SemanticListingIndex;
  indexPath?: string;
  executor?: QueryExecutor;
};

type CompAggregateRow = {
  averagePricePerSqft: number | string | null;
  compCount: number | string | null;
};

type SoldCompPriceRow = {
  City: string | null;
  ClosePrice: number | string | null;
  LivingArea: number | string | null;
};

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;
const COMP_MONTHS = 6;

function round(value: number, digits = 2): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function numeric(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameText(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

function normalizeReference(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeTopK(value?: number): number {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return DEFAULT_TOP_K;
  }
  return Math.min(Math.floor(value), MAX_TOP_K);
}

async function getDefaultExecutor(): Promise<QueryExecutor> {
  const database = await import("./database.ts");
  return database.query;
}

export function calculateHybridScore(
  target: SemanticListing,
  candidate: SemanticListing,
  targetEmbedding: number[],
  candidateEmbedding: number[],
): HybridScore {
  let pricePoints = 0;
  if (target.price != null && candidate.price != null) {
    const priceDifference = Math.abs(target.price - candidate.price);
    if (priceDifference < 50_000) pricePoints = 20;
    else if (priceDifference < 150_000) pricePoints = 12;
    else if (priceDifference < 300_000) pricePoints = 5;
  }

  const bedsPoints =
    target.beds != null && candidate.beds != null && target.beds === candidate.beds
      ? 15
      : 0;
  const cityPoints = sameText(target.city, candidate.city) ? 15 : 0;

  let sqftPoints = 0;
  if (target.sqft != null && candidate.sqft != null) {
    const sqftDifference = Math.abs(target.sqft - candidate.sqft);
    if (sqftDifference < 300) sqftPoints = 10;
    else if (sqftDifference < 700) sqftPoints = 5;
  }

  const structuredScore = pricePoints + bedsPoints + cityPoints + sqftPoints;
  const semanticSimilarity = Math.max(
    0,
    Math.min(1, cosineSimilarity(targetEmbedding, candidateEmbedding)),
  );
  const semanticScore = semanticSimilarity * 40;

  return {
    pricePoints,
    bedsPoints,
    cityPoints,
    sqftPoints,
    structuredScore,
    semanticSimilarity: round(semanticSimilarity, 4),
    semanticScore: round(semanticScore),
    totalScore: round(structuredScore + semanticScore),
  };
}

export function findTargetListing(
  index: SemanticListingIndex,
  reference: string,
): IndexedSemanticListing | null {
  const normalized = normalizeReference(reference);
  if (!normalized) return null;

  const exact = index.listings.find(({ listing }) =>
    [listing.id, listing.displayId, listing.address]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeReference(value) === normalized),
  );
  if (exact) return exact;

  return (
    index.listings.find(({ listing }) => {
      const address = listing.address ? normalizeReference(listing.address) : "";
      return address.length >= 5 && normalized.includes(address);
    }) ?? null
  );
}

export function rankHybridRecommendations(
  target: IndexedSemanticListing,
  index: SemanticListingIndex,
  topK = DEFAULT_TOP_K,
): Array<{ listing: SemanticListing; score: HybridScore }> {
  return index.listings
    .filter(({ listing }) => listing.id !== target.listing.id)
    .map((candidate) => ({
      listing: candidate.listing,
      score: calculateHybridScore(
        target.listing,
        candidate.listing,
        target.embedding,
        candidate.embedding,
      ),
    }))
    .sort(
      (a, b) =>
        b.score.totalScore - a.score.totalScore ||
        b.score.semanticScore - a.score.semanticScore ||
        a.listing.id.localeCompare(b.listing.id),
    )
    .slice(0, safeTopK(topK));
}

export function buildCompValidationQuery(
  city: string,
  sqft: number,
): { sql: string; params: unknown[] } {
  const minimumSqft = Math.round(sqft * 0.8);
  const maximumSqft = Math.round(sqft * 1.2);
  return {
    sql: `
SELECT
  AVG(ClosePrice / NULLIF(LivingArea, 0)) AS averagePricePerSqft,
  COUNT(*) AS compCount
FROM california_sold
WHERE City = ?
  AND PropertyType = ?
  AND LivingArea BETWEEN ? AND ?
  AND ClosePrice > 0
  AND CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
`.trim(),
    params: [city, "Residential", minimumSqft, maximumSqft, COMP_MONTHS],
  };
}

export function buildRecommendationCompRowsQuery(
  listings: SemanticListing[],
): { sql: string; params: unknown[] } | null {
  const comparableListings = listings.filter(
    (listing) => listing.city && listing.sqft != null && listing.sqft > 0,
  );
  if (comparableListings.length === 0) return null;

  const params: unknown[] = ["Residential", COMP_MONTHS];
  const propertyBands = comparableListings.map((listing) => {
    const sqft = listing.sqft as number;
    params.push(
      listing.city,
      Math.round(sqft * 0.8),
      Math.round(sqft * 1.2),
    );
    return "(City = ? AND LivingArea BETWEEN ? AND ?)";
  });

  return {
    sql: `
SELECT City, ClosePrice, LivingArea
FROM california_sold
WHERE PropertyType = ?
  AND CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
  AND ClosePrice > 0
  AND LivingArea > 0
  AND (${propertyBands.join(" OR ")})
`.trim(),
    params,
  };
}

export function createCompValidation(
  listing: SemanticListing,
  row?: CompAggregateRow,
): CompValidation {
  const compCount = numeric(row?.compCount) ?? 0;
  const averagePricePerSqft = numeric(row?.averagePricePerSqft);
  const estimatedCompPrice =
    averagePricePerSqft != null && listing.sqft != null && compCount > 0
      ? round(averagePricePerSqft * listing.sqft, 0)
      : null;
  const deltaPct =
    estimatedCompPrice != null && estimatedCompPrice > 0 && listing.price != null
      ? round(((listing.price - estimatedCompPrice) / estimatedCompPrice) * 100, 1)
      : null;

  let assessment = "Not enough recent sold-comp data";
  if (deltaPct != null) {
    if (Math.abs(deltaPct) <= 3) assessment = "In line with recent comps";
    else if (deltaPct > 0) assessment = `${deltaPct}% above recent comps`;
    else assessment = `${Math.abs(deltaPct)}% below recent comps`;
  }

  const confidence =
    compCount >= 20
      ? "high"
      : compCount >= 5
        ? "medium"
        : compCount > 0
          ? "low"
          : "unavailable";

  return {
    compCount,
    confidence,
    averagePricePerSqft:
      averagePricePerSqft == null ? null : round(averagePricePerSqft),
    estimatedCompPrice,
    listPrice: listing.price,
    deltaPct,
    assessment,
  };
}

export async function validateWithRecentComps(
  listing: SemanticListing,
  executor: QueryExecutor,
): Promise<CompValidation> {
  if (!listing.city || listing.sqft == null || listing.sqft <= 0) {
    return createCompValidation(listing);
  }
  const { sql, params } = buildCompValidationQuery(listing.city, listing.sqft);
  const rows = await executor<CompAggregateRow>(sql, params);
  return createCompValidation(listing, rows[0]);
}

export async function validateRecommendationsWithComps(
  listings: SemanticListing[],
  executor: QueryExecutor,
): Promise<Map<string, CompValidation>> {
  const built = buildRecommendationCompRowsQuery(listings);
  const soldRows = built
    ? await executor<SoldCompPriceRow>(built.sql, built.params)
    : [];
  const validations = new Map<string, CompValidation>();

  for (const listing of listings) {
    if (!listing.city || listing.sqft == null || listing.sqft <= 0) {
      validations.set(listing.id, createCompValidation(listing));
      continue;
    }

    const minimumSqft = listing.sqft * 0.8;
    const maximumSqft = listing.sqft * 1.2;
    const pricesPerSqft = soldRows
      .filter((row) => {
        const livingArea = numeric(row.LivingArea);
        return (
          sameText(row.City, listing.city) &&
          livingArea != null &&
          livingArea >= minimumSqft &&
          livingArea <= maximumSqft
        );
      })
      .map((row) => {
        const closePrice = numeric(row.ClosePrice);
        const livingArea = numeric(row.LivingArea);
        return closePrice != null && livingArea != null && livingArea > 0
          ? closePrice / livingArea
          : null;
      })
      .filter((value): value is number => value != null);
    const averagePricePerSqft =
      pricesPerSqft.length === 0
        ? null
        : pricesPerSqft.reduce((sum, value) => sum + value, 0) /
          pricesPerSqft.length;
    validations.set(
      listing.id,
      createCompValidation(listing, {
        averagePricePerSqft,
        compCount: pricesPerSqft.length,
      }),
    );
  }

  return validations;
}

export async function recommendSimilarListings(
  reference: string,
  options: RecommendationOptions = {},
): Promise<RecommendationResponse> {
  const index =
    options.index ?? (await loadSemanticListingIndex(options.indexPath));
  const target = findTargetListing(index, reference);
  if (!target) {
    throw new Error(
      `Could not find a listing matching "${reference}" in the semantic index. Use a listing ID or indexed street address.`,
    );
  }

  const ranked = rankHybridRecommendations(target, index, options.topK);
  const executor = options.executor ?? (await getDefaultExecutor());
  const validations = await validateRecommendationsWithComps(
    ranked.map(({ listing }) => listing),
    executor,
  );
  const recommendations = ranked.map((result) => ({
    ...result,
    compValidation:
      validations.get(result.listing.id) ?? createCompValidation(result.listing),
  }));

  return { target: target.listing, recommendations };
}
