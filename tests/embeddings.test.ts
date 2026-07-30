import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenAIEmbeddingProvider,
  normalizeEmbeddingText,
} from "../src/embeddings.ts";

test("normalizes whitespace and truncates embedding text", () => {
  assert.equal(
    normalizeEmbeddingText("  bright\n\ncoastal\t home  ", 14),
    "bright coastal",
  );
});

test("creates ordered embeddings through the OpenAI client", async () => {
  let captured:
    | { model: string; input: string[]; encoding_format: "float" }
    | undefined;
  const provider = createOpenAIEmbeddingProvider({
    model: "test-embedding-model",
    client: {
      embeddings: {
        async create(options) {
          captured = options;
          return {
            data: [
              { index: 1, embedding: [0, 1] },
              { index: 0, embedding: [1, 0] },
            ],
          };
        },
      },
    },
  });

  const embeddings = await provider([" first listing ", "second\nlisting"]);

  assert.deepEqual(captured, {
    model: "test-embedding-model",
    input: ["first listing", "second listing"],
    encoding_format: "float",
  });
  assert.deepEqual(embeddings, [
    [1, 0],
    [0, 1],
  ]);
});

test("rejects empty embedding input text", async () => {
  const provider = createOpenAIEmbeddingProvider({
    client: {
      embeddings: {
        async create() {
          return { data: [] };
        },
      },
    },
  });

  await assert.rejects(provider(["   "]), /non-empty text/);
});
