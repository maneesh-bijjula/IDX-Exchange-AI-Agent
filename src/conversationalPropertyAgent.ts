import { searchPropertyCards, type PropertyCard, type QueryExecutor } from "./mlsSearch.ts";
import { parsePropertyQuery, type ParsedPropertyQuery } from "./propertyQueryParser.ts";
import {
  clearSession,
  getSession,
  mergeParsedQueryIntoSession,
  updateSession,
  type ConversationStep,
  type UserSession,
} from "./userSession.ts";

export type ConversationResponse = {
  message: string;
  session: UserSession;
  cards: PropertyCard[];
  askedFor: ConversationStep | null;
};

export type ConversationOptions = {
  page?: number;
  limit?: number;
  executor?: QueryExecutor;
};

const DEFAULT_SEARCH_LIMIT = 3;

function isResetMessage(message: string): boolean {
  return /\b(reset|restart|start over|clear search|new search)\b/i.test(message);
}

function determineNextStep(session: UserSession): ConversationStep {
  if (!session.city) return "collecting_city";
  if (!session.maxPrice) return "collecting_budget";
  if (!session.type) return "collecting_property_type";
  if (!session.beds) return "collecting_beds";
  return "ready";
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function parseLooseMoney(message: string): number | null {
  const match = message.match(/\$?\s*([\d,.]+)\s*(m|million|k|thousand)?\b/i);
  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ""));
  const suffix = match[2]?.toLowerCase();

  if (!Number.isFinite(amount)) return null;
  if (suffix === "m" || suffix === "million") return Math.round(amount * 1_000_000);
  if (suffix === "k" || suffix === "thousand") return Math.round(amount * 1_000);
  return Math.round(amount);
}

function parseLooseNumber(message: string): number | null {
  const match = message.match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? Number(match[1]) : null;
}

function parseLooseCity(message: string): string | null {
  if (/\b(i|want|need|find|home|homes|property|properties|house|houses)\b/i.test(message)) {
    return null;
  }

  const cleaned = message
    .replace(/\b(city|please|search|look|looking|there)\b/gi, "")
    .trim();

  if (!/^[A-Za-z][A-Za-z\s.-]{1,40}$/.test(cleaned)) return null;
  return toTitleCase(cleaned);
}

function applyFocusedReply(
  currentSession: UserSession,
  message: string,
  parsedQuery: ParsedPropertyQuery,
): ParsedPropertyQuery {
  const focusedQuery = { ...parsedQuery };

  if (currentSession.conversationStep === "collecting_city" && !focusedQuery.city) {
    focusedQuery.city = parseLooseCity(message);
  }

  if (currentSession.conversationStep === "collecting_budget" && !focusedQuery.maxPrice) {
    focusedQuery.maxPrice = parseLooseMoney(message);
  }

  if (currentSession.conversationStep === "collecting_beds" && !focusedQuery.beds) {
    focusedQuery.beds = parseLooseNumber(message);
  }

  return focusedQuery;
}

function promptForStep(step: ConversationStep, session: UserSession): string {
  switch (step) {
    case "collecting_city":
      return "Which city should I search in?";
    case "collecting_budget":
      return `Got it — looking in ${session.city}. What is your max budget?`;
    case "collecting_property_type":
      return "What property type do you prefer: condo, townhome, single-family home, or land?";
    case "collecting_beds":
      return "How many bedrooms do you need?";
    default:
      return "I have enough details to run the search.";
  }
}

function sessionToParsedQuery(session: UserSession): ParsedPropertyQuery {
  const dbColumnFilters: ParsedPropertyQuery["dbColumnFilters"] = {};

  if (session.city) dbColumnFilters.L_City = session.city;
  if (session.maxPrice) dbColumnFilters.L_SystemPrice = { lte: session.maxPrice };
  if (session.beds) dbColumnFilters.L_Keyword2 = { gte: session.beds };
  if (session.baths) dbColumnFilters.LM_Dec_3 = { gte: session.baths };
  if (session.sqft) dbColumnFilters.LM_Int2_3 = { gte: session.sqft };
  if (session.type) dbColumnFilters.L_Type_ = session.type;
  if (session.pool) dbColumnFilters.PoolPrivateYN = session.pool;
  if (session.hasView) dbColumnFilters.ViewYN = session.hasView;
  if (session.maxHoa) dbColumnFilters.AssociationFee = { lte: session.maxHoa };

  return {
    city: session.city,
    maxPrice: session.maxPrice,
    beds: session.beds,
    baths: session.baths,
    sqft: session.sqft,
    type: session.type,
    pool: session.pool,
    hasView: session.hasView,
    maxHoa: session.maxHoa,
    dbColumnFilters,
  };
}

function formatCurrency(value: number | null): string {
  if (value == null) return "price unavailable";
  return `$${value.toLocaleString("en-US")}`;
}

function summarizeCard(card: PropertyCard, index: number): string {
  const details = [
    card.beds != null ? `${card.beds} beds` : null,
    card.baths != null ? `${card.baths} baths` : null,
    card.sqft != null ? `${card.sqft.toLocaleString("en-US")} sqft` : null,
    card.highlights.find((highlight) => highlight.includes("photos")) ?? null,
  ].filter(Boolean);

  return `${index + 1}. ${card.title} — ${card.location} — ${formatCurrency(card.price)}${
    details.length ? ` (${details.join(", ")})` : ""
  }`;
}

function buildResultsMessage(cards: PropertyCard[], session: UserSession): string {
  if (cards.length === 0) {
    return "I could not find matching active listings yet. Try widening the budget, property type, or bedroom count.";
  }

  const criteria = [
    session.city,
    session.type,
    session.maxPrice ? `under ${formatCurrency(session.maxPrice)}` : null,
    session.beds ? `${session.beds}+ beds` : null,
    session.pool ? "with a pool" : null,
    session.hasView ? "with a view" : null,
  ].filter(Boolean);

  return [
    `I found ${cards.length} active listing${cards.length === 1 ? "" : "s"} for ${criteria.join(", ")}:`,
    ...cards.map(summarizeCard),
    "You can refine this by saying things like “add pool”, “under $1M”, or “show townhomes instead.”",
  ].join("\n");
}

export async function handlePropertySearchMessage(
  userId: string,
  message: string,
  options: ConversationOptions = {},
): Promise<ConversationResponse> {
  if (isResetMessage(message)) {
    clearSession(userId);
    const session = getSession(userId);
    return {
      message: "Search reset. Which city should I search in?",
      session,
      cards: [],
      askedFor: "collecting_city",
    };
  }

  const currentSession = getSession(userId);
  const parsedQuery = applyFocusedReply(
    currentSession,
    message,
    await parsePropertyQuery(message),
  );
  let session = mergeParsedQueryIntoSession(userId, parsedQuery);
  const nextStep = determineNextStep(session);

  if (nextStep !== "ready") {
    session = updateSession(userId, { conversationStep: nextStep });
    return {
      message: promptForStep(nextStep, session),
      session,
      cards: [],
      askedFor: nextStep,
    };
  }

  const cards = await searchPropertyCards(sessionToParsedQuery(session), {
    page: options.page ?? 1,
    limit: options.limit ?? DEFAULT_SEARCH_LIMIT,
    executor: options.executor,
  });

  session = updateSession(userId, {
    conversationStep: "showing_results",
    lastResults: cards,
  });

  return {
    message: buildResultsMessage(cards, session),
    session,
    cards,
    askedFor: null,
  };
}
