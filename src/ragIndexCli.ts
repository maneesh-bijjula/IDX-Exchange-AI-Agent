import { closeDatabase } from "./database.ts";
import {
  buildDefaultRagDocuments,
  buildRagKnowledgeIndex,
  DEFAULT_RAG_INDEX_PATH,
  saveRagKnowledgeIndex,
} from "./ragKnowledge.ts";

function optionValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const outputPath = optionValue("output") ?? DEFAULT_RAG_INDEX_PATH;

try {
  console.log("Loading Week 8 knowledge sources...");
  const documents = await buildDefaultRagDocuments({
    sourcePaths: {
      primer: optionValue("primer"),
      trestle: optionValue("trestle"),
      handbook: optionValue("handbook"),
    },
  });
  console.log(
    `Building RAG index from ${documents.length} sources: ${documents.map((document) => document.title).join(", ")}`,
  );
  const index = await buildRagKnowledgeIndex(documents, {
    onProgress(completed, total) {
      console.log(`Embedded ${completed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} chunks`);
    },
  });
  await saveRagKnowledgeIndex(index, outputPath);
  console.log(
    `Saved ${index.chunkCount.toLocaleString("en-US")} chunks from ${index.sourceCount} sources to ${outputPath}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
