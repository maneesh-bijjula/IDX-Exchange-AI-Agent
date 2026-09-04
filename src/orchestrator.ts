import {
  createDefaultAgentRegistry,
  type AgentName,
  type AgentRegistry,
  type AgentResult,
} from "./agentRegistry.ts";
import {
  classifyIntent,
  type AgentIntent,
  type IntentClassification,
  type OrchestratorIntent,
} from "./intentClassifier.ts";
import { getSession } from "./userSession.ts";
import { handleEmailWorkflowCommand } from "./emailApprovalWorkflow.ts";
import type { EmailSender } from "./emailTransport.ts";

export type OrchestratorResponse = {
  response: string;
  intent: OrchestratorIntent;
  intents: AgentIntent[];
  routedAgents: AgentName[];
  sections: AgentResult[];
};

export type OrchestratorOptions = {
  registry?: AgentRegistry;
  classifier?: (query: string) => Promise<IntentClassification>;
  emailSender?: EmailSender;
};

type OrchestratorMemory = {
  lastResponse: string;
  lastIntent: OrchestratorIntent;
};

const memory = new Map<string, OrchestratorMemory>();

const INTENT_AGENT: Record<AgentIntent, AgentName> = {
  search: "propertySearchAgent",
  market: "marketStatsAgent",
  recommend: "recommendationAgent",
  knowledge: "ragAgent",
  email: "emailDraftAgent",
};

function formatCombinedResponse(sections: AgentResult[]): string {
  return sections
    .map((section) => `${section.title}\n${section.message}`)
    .join("\n\n");
}

function previousSection(memoryEntry: OrchestratorMemory | undefined): {
  title: string;
  message: string;
} | null {
  if (!memoryEntry) return null;
  const titles: Partial<Record<OrchestratorIntent, string>> = {
    search: "Property Search",
    market: "Market Statistics",
    recommend: "Recommendations",
    knowledge: "Knowledge Answer",
    mixed: "Previous Results",
  };
  const title = titles[memoryEntry.lastIntent];
  return title ? { title, message: memoryEntry.lastResponse } : null;
}

function referencesPreviousResults(query: string): boolean {
  return /\b(?:these|those|the|previous|earlier|above|last)\s+(?:results?|recommendations?|listings?|properties|homes?|summary|answer)\b/i.test(
    query,
  );
}

function followUpClassification(
  userId: string,
  classification: IntentClassification,
): IntentClassification {
  if (classification.intent !== "unknown") return classification;
  const session = getSession(userId);
  if (session.turnCount > 0 && session.conversationStep !== "showing_results") {
    return { intent: "search", intents: ["search"] };
  }
  return classification;
}

export function clearOrchestratorMemory(userId?: string): void {
  if (userId) memory.delete(userId);
  else memory.clear();
}

export function getOrchestratorMemory(userId: string): OrchestratorMemory | null {
  return memory.get(userId) ?? null;
}

export async function orchestrate(
  query: string,
  userId: string,
  options: OrchestratorOptions = {},
): Promise<OrchestratorResponse> {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const emailCommand = await handleEmailWorkflowCommand(normalizedQuery, userId, {
    sender: options.emailSender,
  });
  if (emailCommand.handled) {
    const emailResult: AgentResult = {
      agent: "emailDraftAgent",
      title: "Email Approval",
      message: emailCommand.message ?? "Email action completed.",
      data: emailCommand.draft,
    };
    memory.set(userId, {
      lastResponse: emailResult.message,
      lastIntent: "email",
    });
    return {
      response: emailResult.message,
      intent: "email",
      intents: ["email"],
      routedAgents: ["emailDraftAgent"],
      sections: [emailResult],
    };
  }

  const registry = options.registry ?? createDefaultAgentRegistry();
  const classifier = options.classifier ?? classifyIntent;
  const classification = followUpClassification(
    userId,
    await classifier(normalizedQuery),
  );

  if (classification.intent === "unknown") {
    const response =
      "I'm not sure how to help with that. Try asking about properties, recommendations, market trends, real estate terms, or an email summary.";
    memory.set(userId, { lastResponse: response, lastIntent: "unknown" });
    return {
      response,
      intent: "unknown",
      intents: [],
      routedAgents: [],
      sections: [],
    };
  }

  const domainIntents = classification.intents.filter(
    (intent): intent is Exclude<AgentIntent, "email"> => intent !== "email",
  );
  const domainResults = await Promise.all(
    domainIntents.map((intent) =>
      registry[INTENT_AGENT[intent]](normalizedQuery, { userId }),
    ),
  );

  let sections = domainResults;
  if (classification.intents.includes("email")) {
    const memoryEntry = memory.get(userId);
    const priorSection = referencesPreviousResults(normalizedQuery)
      ? previousSection(memoryEntry)
      : null;
    const emailSections = priorSection
      ? [priorSection, ...domainResults.map(({ title, message }) => ({ title, message }))]
      : domainResults.map(({ title, message }) => ({ title, message }));
    const emailResult = await registry.emailDraftAgent(normalizedQuery, {
      userId,
      sourceSections: emailSections,
      previousResponse: memoryEntry?.lastResponse ?? null,
    });
    sections = domainResults.length > 0 ? [...domainResults, emailResult] : [emailResult];
  }

  const emailResult = sections.find((section) => section.agent === "emailDraftAgent");
  const response = emailResult?.message ?? (sections.length === 1
    ? sections[0].message
    : formatCombinedResponse(sections));
  memory.set(userId, { lastResponse: response, lastIntent: classification.intent });

  return {
    response,
    intent: classification.intent,
    intents: classification.intents,
    routedAgents: sections.map((section) => section.agent),
    sections,
  };
}
