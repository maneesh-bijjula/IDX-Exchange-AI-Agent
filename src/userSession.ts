import type { ParsedPropertyQuery, PropertyType } from "./propertyQueryParser.ts";
import type { PropertyCard } from "./mlsSearch.ts";

export type ConversationStep =
  | "collecting_city"
  | "collecting_budget"
  | "collecting_property_type"
  | "collecting_beds"
  | "ready"
  | "showing_results";

export type UserSession = {
  userId: string;
  city: string | null;
  maxPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: PropertyType | null;
  pool: "True" | null;
  hasView: "True" | null;
  maxHoa: number | null;
  lastResults: PropertyCard[];
  conversationStep: ConversationStep;
  turnCount: number;
  updatedAt: string;
};

const sessions = new Map<string, UserSession>();

function createEmptySession(userId: string): UserSession {
  return {
    userId,
    city: null,
    maxPrice: null,
    beds: null,
    baths: null,
    sqft: null,
    type: null,
    pool: null,
    hasView: null,
    maxHoa: null,
    lastResults: [],
    conversationStep: "collecting_city",
    turnCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function getSession(userId: string): UserSession {
  if (!sessions.has(userId)) {
    sessions.set(userId, createEmptySession(userId));
  }

  return sessions.get(userId)!;
}

export function updateSession(
  userId: string,
  updates: Partial<Omit<UserSession, "userId">>,
): UserSession {
  const currentSession = getSession(userId);
  const nextSession = {
    ...currentSession,
    ...updates,
    userId,
    updatedAt: new Date().toISOString(),
  };

  sessions.set(userId, nextSession);
  return nextSession;
}

export function clearSession(userId: string): void {
  sessions.delete(userId);
}

export function clearAllSessions(): void {
  sessions.clear();
}

export function getSessionCount(): number {
  return sessions.size;
}

export function mergeParsedQueryIntoSession(
  userId: string,
  parsedQuery: ParsedPropertyQuery,
): UserSession {
  const currentSession = getSession(userId);

  return updateSession(userId, {
    city: parsedQuery.city ?? currentSession.city,
    maxPrice: parsedQuery.maxPrice ?? currentSession.maxPrice,
    beds: parsedQuery.beds ?? currentSession.beds,
    baths: parsedQuery.baths ?? currentSession.baths,
    sqft: parsedQuery.sqft ?? currentSession.sqft,
    type: parsedQuery.type ?? currentSession.type,
    pool: parsedQuery.pool ?? currentSession.pool,
    hasView: parsedQuery.hasView ?? currentSession.hasView,
    maxHoa: parsedQuery.maxHoa ?? currentSession.maxHoa,
    turnCount: currentSession.turnCount + 1,
  });
}
