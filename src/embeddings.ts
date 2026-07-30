import OpenAI from "openai";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const MAX_EMBEDDING_TEXT_LENGTH = 8000;

export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>;

type EmbeddingsClient = {
  embeddings: {
    create(options: {
      model: string;
      input: string[];
      encoding_format: "float";
    }): Promise<{
      data: Array<{
        index: number;
        embedding: number[];
      }>;
    }>;
  };
};

export type OpenAIEmbeddingProviderOptions = {
  apiKey?: string;
  model?: string;
  client?: EmbeddingsClient;
};

export function normalizeEmbeddingText(
  text: string,
  maxLength = MAX_EMBEDDING_TEXT_LENGTH,
): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.slice(0, Math.max(1, Math.floor(maxLength)));
}

export function createOpenAIEmbeddingProvider(
  options: OpenAIEmbeddingProviderOptions = {},
): EmbeddingProvider {
  const model =
    options.model ??
    process.env.OPENAI_EMBEDDING_MODEL ??
    DEFAULT_EMBEDDING_MODEL;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

  if (!options.client && !apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for Week 6 embedding generation and semantic search.",
    );
  }

  const client = options.client ?? new OpenAI({ apiKey });

  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];

    const input = texts.map((text) => normalizeEmbeddingText(text));
    if (input.some((text) => !text)) {
      throw new Error("Embedding input must contain non-empty text.");
    }

    const response = await client.embeddings.create({
      model,
      input,
      encoding_format: "float",
    });

    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== input.length) {
      throw new Error(
        `OpenAI returned ${ordered.length} embeddings for ${input.length} inputs.`,
      );
    }

    return ordered.map((item) => item.embedding);
  };
}
