import { handlePropertySearchMessage } from "./conversationalPropertyAgent.ts";
import {
  draftEmailSummary,
  type EmailSourceSection,
} from "./emailDraftAgent.ts";
import { answerMarketQuestion } from "./marketStatisticsAgent.ts";
import { answerRagQuestion } from "./ragKnowledge.ts";
import { answerRecommendationQuery } from "./recommendationAgent.ts";
import { answerSemanticPropertyQuery } from "./semanticPropertyAgent.ts";
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

function recommendationReference(query: string, userId: string): string {
  if (/\b(?:like|similar to|alternatives? (?:to|for))\b/i.test(query)) return query;
  const lastResult = getSession(userId).lastResults[0];
  return lastResult?.title ?? String(lastResult?.id ?? query);
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
      const result = await answerRecommendationQuery(
        recommendationReference(query, context.userId),
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
