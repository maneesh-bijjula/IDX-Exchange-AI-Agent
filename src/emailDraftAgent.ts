import {
  extractEmailRecipient,
  formatEmailDraftPreview,
  queueEmailDraft,
  type EmailDraftStatus,
} from "./emailApprovalWorkflow.ts";
import { isWeeklyMarketReportRequest } from "./weeklyMarketReport.ts";

export type EmailSourceSection = {
  title: string;
  message: string;
};

export type EmailDraftRequest = {
  query: string;
  userId?: string;
  sections?: EmailSourceSection[];
  previousResponse?: string | null;
};

export type EmailDraftResponse = {
  message: string;
  to: string | null;
  subject: string | null;
  body: string | null;
  status: EmailDraftStatus | "draft_only" | null;
  approvalId: string | null;
};

function inferSubject(query: string, sections: EmailSourceSection[]): string {
  const city =
    query.match(
      /\bweekly\s+(?:real\s+estate\s+)?market\s+report\s+(?:for|in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)(?=\s+(?:to|for)\s+[\w.+-]+@|[,.!?]|$)/i,
    )?.[1] ??
    query.match(
      /\bweekly\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)\s+market\s+report\b/i,
    )?.[1] ??
    query.match(
      /\b(?:summarize|summarise|summarizing|summarising)\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)\s+market\b/i,
    )?.[1] ??
    query.match(
      /\b(?:in|for|about)\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)(?=\s+(?:market|homes?|properties|listings|summary|update)\b|[,.!?]|$)/i,
    )?.[1] ??
    query.match(
      /\bthe\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}?)\s+market\s+(?:conditions?|summary|update|trends?|statistics|stats)\b/i,
    )?.[1];
  const hasMarket = sections.some((section) => /market/i.test(section.title));
  const hasProperties = sections.some((section) =>
    /property|properties|listing|recommend/i.test(section.title),
  );
  const isWeeklyMarketReport = isWeeklyMarketReportRequest(query);
  const topic = isWeeklyMarketReport
    ? "Weekly Market Report"
    : hasMarket && hasProperties
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
      to: null,
      subject: null,
      body: null,
      status: null,
      approvalId: null,
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

  const recipient = extractEmailRecipient(request.query);
  if (recipient && request.userId) {
    const pendingDraft = queueEmailDraft({
      userId: request.userId,
      to: recipient,
      subject,
      body,
    });
    return {
      to: recipient,
      subject,
      body,
      status: pendingDraft.status,
      approvalId: pendingDraft.id,
      message: formatEmailDraftPreview(pendingDraft),
    };
  }

  return {
    to: recipient,
    subject,
    body,
    status: "draft_only",
    approvalId: null,
    message: [
      `Subject: ${subject}`,
      "",
      body,
      "",
      "Draft only. Nothing has been sent.",
      recipient
        ? "This preview is not attached to a user session, so it cannot be approved."
        : "Include a recipient email address to queue this draft for approval.",
    ].join("\n"),
  };
}
