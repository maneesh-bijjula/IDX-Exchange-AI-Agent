import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  answerRagQuestion,
  buildGroundedContext,
  buildRagKnowledgeIndex,
  chunkText,
  collectRagCitations,
  createOpenAIRagAnswerProvider,
  loadRagKnowledgeIndex,
  rankRagChunks,
  saveRagKnowledgeIndex,
  type RagKnowledgeIndex,
  type RagSourceDocument,
} from "../src/ragKnowledge.ts";

function documents(): RagSourceDocument[] {
  return [
    {
      id: "primer",
      title: "Real Estate Primer",
      sourcePath: "/docs/primer.pdf",
      kind: "pdf",
      pages: [
        {
          page: 6,
          text: "Days on Market (DOM) measures how long a property is listed before going under contract or selling.",
        },
        {
          page: 3,
          text: "The list-to-close ratio compares ClosePrice with ListPrice and indicates negotiation leverage.",
        },
      ],
    },
    {
      id: "schema",
      title: "IDX Schema Reference",
      sourcePath: "/docs/handbook.pdf",
      kind: "pdf",
      pages: [
        {
          page: 5,
          text: "california_sold columns include ListingKey, ClosePrice, CloseDate, ListPrice, DaysOnMarket, PropertyType, LivingArea, BedroomsTotal, and YearBuilt.",
        },
      ],
    },
  ];
}

function index(): RagKnowledgeIndex {
  return {
    version: 1,
    model: "test-model",
    dimensions: 2,
    generatedAt: "2026-08-20T00:00:00.000Z",
    sourceCount: 2,
    chunkCount: 3,
    sources: [],
    chunks: [
      {
        id: "dom",
        sourceId: "primer",
        sourceTitle: "Real Estate Primer",
        sourcePath: "/docs/primer.pdf",
        page: 6,
        chunkIndex: 0,
        text: "DOM means Days on Market.",
        embedding: [1, 0],
      },
      {
        id: "ratio",
        sourceId: "primer",
        sourceTitle: "Real Estate Primer",
        sourcePath: "/docs/primer.pdf",
        page: 3,
        chunkIndex: 1,
        text: "The list-to-close ratio compares close and list prices.",
        embedding: [0.7, 0.3],
      },
      {
        id: "schema",
        sourceId: "schema",
        sourceTitle: "IDX Schema Reference",
        sourcePath: "/docs/handbook.pdf",
        page: 5,
        chunkIndex: 0,
        text: "california_sold has ClosePrice and CloseDate columns.",
        embedding: [0, 1],
      },
    ],
  };
}

test("chunks normalized text with overlap without creating empty chunks", () => {
  const text = Array.from({ length: 80 }, (_, item) => `sentence ${item}.`).join(" ");
  const chunks = chunkText(`  ${text}\n\n`, 180, 30);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 180));
  assert.match(chunks[0], /^sentence 0/);
});

test("builds a batched index with source and page metadata", async () => {
  const batchSizes: number[] = [];
  const built = await buildRagKnowledgeIndex(documents(), {
    chunkSize: 500,
    overlap: 50,
    batchSize: 2,
    model: "test-model",
    embeddingProvider: async (texts) => {
      batchSizes.push(texts.length);
      return texts.map((_, item) => [batchSizes.length, item + 1]);
    },
  });

  assert.equal(built.sourceCount, 2);
  assert.equal(built.chunkCount, 3);
  assert.deepEqual(batchSizes, [2, 1]);
  assert.equal(built.chunks[0].sourceTitle, "Real Estate Primer");
  assert.equal(built.chunks[0].page, 6);
});

test("ranks chunks by cosine similarity", () => {
  const matches = rankRagChunks([1, 0], index(), 2);
  assert.deepEqual(
    matches.map((match) => match.id),
    ["dom", "ratio"],
  );
  assert.equal(matches[0].score, 1);
});

test("builds labeled context and deduplicated page citations", () => {
  const matches = rankRagChunks([1, 0], index(), 3);
  const context = buildGroundedContext(matches);
  const citations = collectRagCitations(matches);

  assert.match(context, /\[Real Estate Primer, p\. 6\]/);
  assert.deepEqual(citations[0], {
    sourceId: "primer",
    title: "Real Estate Primer",
    pages: [3, 6],
  });
});

test("answers from retrieved context and appends a source list", async () => {
  let capturedContext = "";
  const result = await answerRagQuestion("What does DOM mean?", {
    index: index(),
    topK: 1,
    embeddingProvider: async () => [[1, 0]],
    answerProvider: async ({ context }) => {
      capturedContext = context;
      return "DOM means Days on Market. [Real Estate Primer, p. 6]";
    },
  });

  assert.match(capturedContext, /DOM means Days on Market/);
  assert.match(result.message, /Sources:\n- Real Estate Primer, p\. 6/);
  assert.equal(result.matches.length, 1);
});

test("creates a constrained OpenAI Responses API request", async () => {
  let captured:
    | { model: string; instructions: string; input: string; store: boolean }
    | undefined;
  const provider = createOpenAIRagAnswerProvider({
    model: "test-generation-model",
    client: {
      responses: {
        async create(options) {
          captured = options;
          return { output_text: "Grounded answer [Source]." };
        },
      },
    },
  });

  const answer = await provider({
    question: "What is DOM?",
    context: "[Source 1] DOM is Days on Market.",
  });

  assert.equal(answer, "Grounded answer [Source].");
  assert.equal(captured?.model, "test-generation-model");
  assert.equal(captured?.store, false);
  assert.match(captured?.instructions ?? "", /Answer only from/);
  assert.match(captured?.input ?? "", /Question: What is DOM\?/);
});

test("saves and loads a valid RAG index", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "idx-rag-test-"));
  const indexPath = path.join(directory, "index.json");
  try {
    await saveRagKnowledgeIndex(index(), indexPath);
    assert.deepEqual(await loadRagKnowledgeIndex(indexPath), index());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
