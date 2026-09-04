export type AgentIntent =
  | "search"
  | "market"
  | "recommend"
  | "knowledge"
  | "email";

export type OrchestratorIntent = AgentIntent | "mixed" | "unknown";

export type IntentClassification = {
  intent: OrchestratorIntent;
  intents: AgentIntent[];
};

const INTENT_ORDER: AgentIntent[] = [
  "search",
  "market",
  "recommend",
  "knowledge",
  "email",
];

function hasKnowledgeIntent(query: string): boolean {
  return (
    /\b(?:define|definition|meaning|stand for|what does|what are the columns|which columns|schema|field definition)\b/i.test(
      query,
    ) ||
    /\bwhat (?:is|are)\s+(?:a\s+|an\s+|the\s+)?(?:dom|days on market|list[-\s]?to[-\s]?close ratio|sale[-\s]?to[-\s]?list ratio|escrow|comps?|cap rate|l_systemprice|l_keyword2|lm_dec_3|lm_int2_3|standardstatus)\b/i.test(
      query,
    ) ||
    /\b(?:california_sold|rets_property)\b.*\b(?:columns?|fields?|schema|mean|definition)\b/i.test(
      query,
    )
  );
}

function hasRecommendationIntent(query: string): boolean {
  return /\b(?:recommend|recommendation|similar (?:home|homes|properties|listings)|homes? like|properties like|listings? like|alternatives? (?:to|for)|comparable active listings?)\b/i.test(
    query,
  );
}

function hasMarketIntent(query: string, knowledge: boolean): boolean {
  if (knowledge) return false;
  return /\b(?:market|market stats?|market statistics|prices?\s+(?:are\s+)?(?:rising|falling|increasing|decreasing|trending)|price trends?|median (?:close )?price|average (?:close )?price|price per (?:sq\.?\s*ft|square foot)|inventory|months of supply|sold volume|closed sales|recent sales|year[-\s]?over[-\s]?year|month[-\s]?over[-\s]?month|list[-\s]?to[-\s]?close|sale[-\s]?to[-\s]?list|days on market|\bDOM\b|good time to (?:buy|sell))\b/i.test(
    query,
  );
}

function hasSearchIntent(query: string, recommend: boolean): boolean {
  if (recommend) return false;
  return (
    /\b(?:find|search|show|looking for|look for|i want|i need)\b[^.!?]*\b(?:home|homes|house|houses|property|properties|listing|listings|condo|condos|townhome|townhomes|land|lots?)\b/i.test(
      query,
    ) ||
    /\b(?:homes|houses|properties|listings|condos|townhomes|land|lots?)\s+(?:in|near|around)\b/i.test(
      query,
    ) ||
    /\b(?:under|below|up to)\s+\$?[\d,.]+\s*(?:m|million|k|thousand)?\b|\b\d+(?:\.\d+)?\s*(?:beds?|bedrooms?|baths?|bathrooms?)\b|\b(?:add|must have|with)\s+(?:a\s+)?(?:pool|view)|\bshow\s+(?:condos|townhomes|houses|homes|land)\b/i.test(
      query,
    ) ||
    /\b(?:find|show|want|looking for)\b[^.!?]*\b(?:charming|craftsman|character|peaceful|modern|coastal|historic|mountain views?|original details|open layout|surrounded by nature|garden)\b/i.test(
      query,
    ) ||
    /\b(?:reset|restart|start over|clear search|new search)\b/i.test(query)
  );
}

function hasEmailIntent(query: string): boolean {
  return (
    /\b(?:draft|write|compose|prepare|create)\b[^.!?]*\b(?:email|message|summary email)\b|\bemail (?:this|that|these|those|the results?|the summary)\b/i.test(
      query,
    ) ||
    /\b(?:draft|write|compose|prepare|create)\b[^.!?]*\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(
      query,
    )
  );
}

export async function classifyIntent(query: string): Promise<IntentClassification> {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (!normalized) return { intent: "unknown", intents: [] };

  const knowledge = hasKnowledgeIntent(normalized);
  const recommend = hasRecommendationIntent(normalized);
  const detected = new Set<AgentIntent>();

  if (hasSearchIntent(normalized, recommend)) detected.add("search");
  if (hasMarketIntent(normalized, knowledge)) detected.add("market");
  if (recommend) detected.add("recommend");
  if (knowledge) detected.add("knowledge");
  if (hasEmailIntent(normalized)) detected.add("email");

  const intents = INTENT_ORDER.filter((intent) => detected.has(intent));
  if (intents.length === 0) return { intent: "unknown", intents };
  if (intents.length === 1) return { intent: intents[0], intents };
  return { intent: "mixed", intents };
}
