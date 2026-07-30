import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createOpenAIEmbeddingProvider,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingProvider,
} from "./embeddings.ts";
import { type QueryExecutor } from "./mlsSearch.ts";

export type SemanticListingRow = {
  L_ListingID: string | number | null;
  L_DisplayId: string | null;
  L_Address: string | null;
  L_City: string | null;
  L_Zip: string | number | null;
  L_SystemPrice: number | string | null;
  L_Keyword2: number | string | null;
  LM_Dec_3: number | string | null;
  LM_Int2_3: number | string | null;
  L_Type_: string | null;
  L_Status: string | null;
  YearBuilt: number | string | null;
  L_Remarks: string | null;
};

export type SemanticListing = {
  id: string;
  displayId: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  status: string | null;
  yearBuilt: number | null;
  remarks: string;
};

export type IndexedSemanticListing = {
  listing: SemanticListing;
  embedding: number[];
};

export type SemanticListingIndex = {
  version: 1;
  model: string;
  dimensions: number;
  generatedAt: string;
  listingCount: number;
  listings: IndexedSemanticListing[];
};

export type SemanticSearchResult = {
  listing: SemanticListing;
  score: number;
};

export type BuildSemanticIndexOptions = {
  limit?: number;
  city?: string | null;
  batchSize?: number;
  model?: string;
  executor?: QueryExecutor;
  embeddingProvider?: EmbeddingProvider;
  onProgress?: (completed: number, total: number) => void;
};

export type SemanticSearchOptions = {
  topK?: number;
  index?: SemanticListingIndex;
  indexPath?: string;
  embeddingProvider?: EmbeddingProvider;
};

const DEFAULT_INDEX_LIMIT = 1000;
const MAX_INDEX_LIMIT = 100000;
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

export const DEFAULT_SEMANTIC_INDEX_PATH = path.resolve(
  process.cwd(),
  process.env.SEMANTIC_INDEX_PATH ?? "data/semantic-listing-index.json",
);

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value == null || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function numeric(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: string | number | null): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

async function getDefaultExecutor(): Promise<QueryExecutor> {
  const database = await import("./database.ts");
  return database.query;
}

export function buildSemanticListingRowsQuery(
  options: Pick<BuildSemanticIndexOptions, "limit" | "city"> = {},
): { sql: string; params: unknown[] } {
  const limit = positiveInteger(
    options.limit,
    DEFAULT_INDEX_LIMIT,
    MAX_INDEX_LIMIT,
  );
  const params: unknown[] = ["Active", ""];

  let sql = `
SELECT
  L_ListingID,
  L_DisplayId,
  L_Address,
  L_City,
  L_Zip,
  L_SystemPrice,
  L_Keyword2,
  LM_Dec_3,
  LM_Int2_3,
  L_Type_,
  L_Status,
  YearBuilt,
  L_Remarks
FROM rets_property
WHERE L_Status = ?
  AND L_Remarks IS NOT NULL
  AND TRIM(L_Remarks) <> ?
`;

  if (options.city) {
    sql += "  AND L_City = ?\n";
    params.push(options.city);
  }

  sql += `ORDER BY L_ListingID ASC LIMIT ${limit}`;
  return { sql, params };
}

export function mapSemanticListingRow(
  row: SemanticListingRow,
): SemanticListing | null {
  const id = stringValue(row.L_ListingID ?? row.L_DisplayId);
  const remarks = row.L_Remarks?.replace(/\s+/g, " ").trim() ?? "";
  if (!id || !remarks) return null;

  return {
    id,
    displayId: stringValue(row.L_DisplayId),
    address: stringValue(row.L_Address),
    city: stringValue(row.L_City),
    zip: stringValue(row.L_Zip),
    price: numeric(row.L_SystemPrice),
    beds: numeric(row.L_Keyword2),
    baths: numeric(row.LM_Dec_3),
    sqft: numeric(row.LM_Int2_3),
    type: stringValue(row.L_Type_),
    status: stringValue(row.L_Status),
    yearBuilt: numeric(row.YearBuilt),
    remarks,
  };
}

export function buildListingEmbeddingText(listing: SemanticListing): string {
  const location = [listing.city, listing.zip].filter(Boolean).join(", ");
  const details = [
    listing.type ? `Property type: ${listing.type}.` : null,
    location ? `Location: ${location}, California.` : null,
    listing.beds != null ? `Bedrooms: ${listing.beds}.` : null,
    listing.baths != null ? `Bathrooms: ${listing.baths}.` : null,
    listing.sqft != null ? `Living area: ${listing.sqft} square feet.` : null,
    listing.yearBuilt != null ? `Built in ${listing.yearBuilt}.` : null,
    listing.price != null ? `Price: $${listing.price}.` : null,
    `Listing description: ${listing.remarks}`,
  ].filter((value): value is string => Boolean(value));

  return details.join(" ");
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const aValue = a[index];
    const bValue = b[index];
    if (!Number.isFinite(aValue) || !Number.isFinite(bValue)) return 0;
    dotProduct += aValue * bValue;
    normA += aValue * aValue;
    normB += bValue * bValue;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function rankSemanticListings(
  queryEmbedding: number[],
  index: SemanticListingIndex,
  topK = DEFAULT_TOP_K,
): SemanticSearchResult[] {
  const safeTopK = positiveInteger(topK, DEFAULT_TOP_K, MAX_TOP_K);

  return index.listings
    .map(({ listing, embedding }) => ({
      listing,
      score: cosineSimilarity(queryEmbedding, embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, safeTopK);
}

export async function buildSemanticListingIndex(
  options: BuildSemanticIndexOptions = {},
): Promise<SemanticListingIndex> {
  const model =
    options.model ??
    process.env.OPENAI_EMBEDDING_MODEL ??
    DEFAULT_EMBEDDING_MODEL;
  const executor = options.executor ?? (await getDefaultExecutor());
  const embeddingProvider =
    options.embeddingProvider ?? createOpenAIEmbeddingProvider({ model });
  const batchSize = positiveInteger(
    options.batchSize,
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
  );
  const { sql, params } = buildSemanticListingRowsQuery(options);
  const rows = await executor<SemanticListingRow>(sql, params);
  const listings = rows
    .map(mapSemanticListingRow)
    .filter((listing): listing is SemanticListing => listing != null);
  const indexedListings: IndexedSemanticListing[] = [];
  let dimensions: number | null = null;

  for (let start = 0; start < listings.length; start += batchSize) {
    const batch = listings.slice(start, start + batchSize);
    const embeddings = await embeddingProvider(
      batch.map(buildListingEmbeddingText),
    );

    if (embeddings.length !== batch.length) {
      throw new Error(
        `Embedding provider returned ${embeddings.length} vectors for ${batch.length} listings.`,
      );
    }

    batch.forEach((listing, index) => {
      const embedding = embeddings[index];
      if (!embedding || embedding.length === 0) {
        throw new Error(`Listing ${listing.id} received an empty embedding.`);
      }
      dimensions ??= embedding.length;
      if (embedding.length !== dimensions) {
        throw new Error(
          `Listing ${listing.id} received ${embedding.length} dimensions; expected ${dimensions}.`,
        );
      }
      indexedListings.push({ listing, embedding });
    });

    options.onProgress?.(indexedListings.length, listings.length);
  }

  return {
    version: 1,
    model,
    dimensions: dimensions ?? 0,
    generatedAt: new Date().toISOString(),
    listingCount: indexedListings.length,
    listings: indexedListings,
  };
}

export async function saveSemanticListingIndex(
  index: SemanticListingIndex,
  indexPath = DEFAULT_SEMANTIC_INDEX_PATH,
): Promise<void> {
  await mkdir(path.dirname(indexPath), { recursive: true });
  const temporaryPath = `${indexPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(index), "utf8");
  await rename(temporaryPath, indexPath);
}

export async function loadSemanticListingIndex(
  indexPath = DEFAULT_SEMANTIC_INDEX_PATH,
): Promise<SemanticListingIndex> {
  let raw: string;
  try {
    raw = await readFile(indexPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Semantic index not found at ${indexPath}. Run npm run week6:index first.`,
      );
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as SemanticListingIndex;
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.listings) ||
    parsed.listingCount !== parsed.listings.length ||
    !Number.isInteger(parsed.dimensions) ||
    parsed.dimensions < 0 ||
    parsed.listings.some(
      (item) =>
        !Array.isArray(item.embedding) ||
        item.embedding.length !== parsed.dimensions,
    )
  ) {
    throw new Error(`Invalid semantic listing index at ${indexPath}.`);
  }

  return parsed;
}

export async function searchSemanticListings(
  queryText: string,
  options: SemanticSearchOptions = {},
): Promise<SemanticSearchResult[]> {
  const normalizedQuery = queryText.replace(/\s+/g, " ").trim();
  if (!normalizedQuery) {
    throw new Error("Describe the kind of property you want to find.");
  }

  const index =
    options.index ??
    (await loadSemanticListingIndex(
      options.indexPath ?? DEFAULT_SEMANTIC_INDEX_PATH,
    ));
  if (index.listings.length === 0) return [];

  const embeddingProvider =
    options.embeddingProvider ??
    createOpenAIEmbeddingProvider({ model: index.model });
  const [queryEmbedding] = await embeddingProvider([normalizedQuery]);
  if (!queryEmbedding) {
    throw new Error("The query did not receive an embedding.");
  }
  if (queryEmbedding.length !== index.dimensions) {
    throw new Error(
      `Query embedding has ${queryEmbedding.length} dimensions, but the index uses ${index.dimensions}. Rebuild the index with the configured model.`,
    );
  }

  return rankSemanticListings(queryEmbedding, index, options.topK);
}
