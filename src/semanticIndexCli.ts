import { closeDatabase } from "./database.ts";
import {
  buildSemanticListingIndex,
  DEFAULT_SEMANTIC_INDEX_PATH,
  saveSemanticListingIndex,
} from "./semanticPropertySearch.ts";

type IndexArguments = {
  limit: number;
  batchSize: number;
  city: string | null;
};

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function positiveNumber(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function parseIndexArguments(args: string[]): IndexArguments {
  const limit = args.includes("--all")
    ? 100000
    : positiveNumber(valueAfter(args, "--limit"), 1000);
  const batchSize = positiveNumber(valueAfter(args, "--batch-size"), 50);
  const city = valueAfter(args, "--city")?.trim() || null;

  return { limit, batchSize, city };
}

const options = parseIndexArguments(process.argv.slice(2));

try {
  console.log(
    `Building semantic index for up to ${options.limit.toLocaleString("en-US")} active listings${options.city ? ` in ${options.city}` : ""}...`,
  );
  const index = await buildSemanticListingIndex({
    ...options,
    onProgress(completed, total) {
      console.log(
        `Embedded ${completed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} listings`,
      );
    },
  });
  await saveSemanticListingIndex(index);
  console.log(
    `Saved ${index.listingCount.toLocaleString("en-US")} listing embeddings to ${DEFAULT_SEMANTIC_INDEX_PATH}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
