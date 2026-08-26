import { handlePropertySearchMessage } from "./conversationalPropertyAgent.ts";
import {
  draftEmailSummary,
  type EmailSourceSection,
} from "./emailDraftAgent.ts";
import { answerMarketQuestion } from "./marketStatisticsAgent.ts";
import { answerRagQuestion } from "./ragKnowledge.ts";
import { answerRecommendationQuery } from "./recommendationAgent.ts";
import { answerSemanticPropertyQuery } from "./semanticPropertyAgent.ts";
import type { PropertyCard } from "./mlsSearch.ts";
import type { SemanticListing } from "./semanticPropertySearch.ts";
import { getSession } from "./userSession.ts";

export type AgentName =
  | "propertySearchAgent"
  | "marketStatsAgent"
  | "recommendationAgent"
  | "ragAgent"
  | "emailDraftAgent";

export type AgentResult = {
  agent: AgentName;
  title: string;
  message: string;
  data?: unknown;
};

export type AgentContext = {
  userId: string;
  sourceSections?: EmailSourceSection[];
  previousResponse?: string | null;
};

export type RegisteredAgent = (
  query: string,
  context: AgentContext,
) => Promise<AgentResult>;

export type AgentRegistry = Record<AgentName, RegisteredAgent>;

export const AGENT_NAMES: AgentName[] = [
  "propertySearchAgent",
  "marketStatsAgent",
  "recommendationAgent",
  "ragAgent",
  "emailDraftAgent",
];

export type RecommendationRequest = {
  reference: string;
  targetListing?: SemanticListing;
};

function resultPosition(query: string, resultCount: number): number | null {
  const positions: Array<[RegExp, number]> = [
    [/\b(?:first|1st)\b/i, 0],
    [/\b(?:second|2nd)\b/i, 1],
    [/\b(?:third|3rd)\b/i, 2],
    [/\b(?:fourth|4th)\b/i, 3],
    [/\b(?:fifth|5th)\b/i, 4],
  ];
  const matched = positions.find(([pattern]) => pattern.test(query));
  if (matched) return matched[1] < resultCount ? matched[1] : null;
  if (/\blast (?:result|listing|home|property)\b/i.test(query)) {
    return resultCount > 0 ? resultCount - 1 : null;
  }
  return null;
}

function cardNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cardToSemanticListing(card: PropertyCard): SemanticListing {
  const zipMatch = card.location.match(/(?:^|,\s*)(\d{5})(?:-\d{4})?$/);
  const zip = zipMatch?.[1] ?? null;
  const city = card.location
    .replace(/,?\s*\d{5}(?:-\d{4})?\s*$/, "")
    .trim() || null;
  const highlights = card.highlights.join(". ");
  const yearMatch = highlights.match(/\bBuilt(?: in)?\s+(\d{4})\b/i);

  return {
    id: String(card.id ?? card.title),
    displayId: card.id == null ? null : String(card.id),
    address: card.title,
    city,
    zip,
    price: cardNumber(card.price),
    beds: cardNumber(card.beds),
    baths: cardNumber(card.baths),
    sqft: cardNumber(card.sqft),
    type: card.type,
    status: card.status,
    yearBuilt: yearMatch ? Number(yearMatch[1]) : null,
    remarks:
      highlights ||
      `${card.type ?? "Active property"} at ${card.title} in ${card.location}.`,
  };
}

export function resolveRecommendationRequest(
  query: string,
  userId: string,
): RecommendationRequest {
  const results = getSession(userId).lastResults;
  const position = resultPosition(query, results.length);
  const previousResult = position == null ? null : results[position];

  if (previousResult) {
    return {
      reference: previousResult.title,
      targetListing: cardToSemanticListing(previousResult),
    };
  }

  if (/\b(?:like|similar to|alternatives? (?:to|for))\b/i.test(query)) {
    return { reference: query };
  }
  const firstResult = results[0];
  return firstResult
    ? {
        reference: firstResult.title,
        targetListing: cardToSemanticListing(firstResult),
      }
    : { reference: query };
}

export function isSemanticPropertyRequest(query: string): boolean {
  return /\b(?:charming|craftsman|character|peaceful|modern|coastal|historic|mountain views?|scenic|architecture|atmosphere|original details|open layout|surrounded by nature|garden)\b/i.test(
    query,
  );
}

export function createDefaultAgentRegistry(): AgentRegistry {
  return {
    async propertySearchAgent(query, context) {
      if (isSemanticPropertyRequest(query)) {
        const result = await answerSemanticPropertyQuery(query);
        return {
          agent: "propertySearchAgent",
          title: "Property Search",
          message: result.message,
          data: result,
        };
      }
      const result = await handlePropertySearchMessage(context.userId, query);
      return {
        agent: "propertySearchAgent",
        title: "Property Search",
        message: result.message,
        data: result,
      };
    },

    async marketStatsAgent(query) {
      const result = await answerMarketQuestion(query);
      return {
        agent: "marketStatsAgent",
        title: "Market Statistics",
        message: result.message,
        data: result,
      };
    },

    async recommendationAgent(query, context) {
      const request = resolveRecommendationRequest(query, context.userId);
      const result = await answerRecommendationQuery(
        request.reference,
        { targetListing: request.targetListing },
      );
      return {
        agent: "recommendationAgent",
        title: "Recommendations",
        message: result.message,
        data: result,
      };
    },

    async ragAgent(query) {
      const result = await answerRagQuestion(query);
      return {
        agent: "ragAgent",
        title: "Knowledge Answer",
        message: result.message,
        data: result,
      };
    },

    async emailDraftAgent(query, context) {
      const result = await draftEmailSummary({
        query,
        sections: context.sourceSections,
        previousResponse: context.previousResponse,
      });
      return {
        agent: "emailDraftAgent",
        title: "Email Draft",
        message: result.message,
        data: result,
      };
    },
  };
}
