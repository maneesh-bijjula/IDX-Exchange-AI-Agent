export type EmailSourceSection = {
  title: string;
  message: string;
};

export type EmailDraftRequest = {
  query: string;
  sections?: EmailSourceSection[];
  previousResponse?: string | null;
};

export type EmailDraftResponse = {
  message: string;
  subject: string | null;
  body: string | null;
};

function inferSubject(query: string, sections: EmailSourceSection[]): string {
  const city =
    query.match(
      /\b(?:summarize|summarise|summarizing|summarising)\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)\s+market\b/i,
    )?.[1] ??
    query.match(
      /\b(?:in|for|about)\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)(?=\s+(?:market|homes?|properties|listings|summary|update)\b|[,.!?]|$)/i,
    )?.[1];
  const hasMarket = sections.some((section) => /market/i.test(section.title));
  const hasProperties = sections.some((section) =>
    /property|properties|listing|recommend/i.test(section.title),
  );
  const topic = hasMarket && hasProperties
    ? "Property and Market Update"
    : hasMarket
      ? "Market Update"
      : hasProperties
        ? "Property Update"
        : "Real Estate Update";
  return city ? `${city} ${topic}` : topic;
}

function cleanSection(message: string): string {
  return message.replace(/\n{3,}/g, "\n\n").trim();
}

export async function draftEmailSummary(
  request: EmailDraftRequest,
): Promise<EmailDraftResponse> {
  const sections = (request.sections ?? []).filter((section) => section.message.trim());
  if (sections.length === 0 && request.previousResponse?.trim()) {
    sections.push({ title: "Real Estate Summary", message: request.previousResponse });
  }

  if (sections.length === 0) {
    return {
      message: "I need property results or a market summary before I can draft the email.",
      subject: null,
      body: null,
    };
  }

  const subject = inferSubject(request.query, sections);
  const sectionText = sections
    .map((section) => `${section.title}\n${cleanSection(section.message)}`)
    .join("\n\n");
  const body = [
    "Hi,",
    "",
    "Here is the requested IDX Exchange real estate summary:",
    "",
    sectionText,
    "",
    "Please let me know if you would like to discuss any of these details.",
    "",
    "Best,",
    "IDX Exchange",
  ].join("\n");

  return {
    subject,
    body,
    message: `Subject: ${subject}\n\n${body}`,
  };
}
