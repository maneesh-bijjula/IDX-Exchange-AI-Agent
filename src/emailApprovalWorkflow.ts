import { randomUUID } from "node:crypto";
import {
  sendEmailWithSmtp,
  type EmailDeliveryReceipt,
  type EmailSender,
  type OutboundEmail,
} from "./emailTransport.ts";

export const MAX_EMAIL_SOURCE_ROWS = 50;
export const EMAIL_APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000;

export type EmailDraftStatus =
  | "pending_approval"
  | "sending"
  | "sent"
  | "cancelled";

export type PendingEmailDraft = OutboundEmail & {
  id: string;
  userId: string;
  status: EmailDraftStatus;
  createdAt: string;
  expiresAt: string;
  sourceRowCount: number;
  messageId: string | null;
};

export type QueueEmailDraftRequest = OutboundEmail & {
  userId: string;
  sourceRowCount?: number;
  now?: Date;
  id?: string;
};

export type EmailWorkflowCommandResult = {
  handled: boolean;
  message?: string;
  draft?: PendingEmailDraft;
};

const drafts = new Map<string, PendingEmailDraft>();

export function extractEmailRecipient(query: string): string | null {
  const match = query.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match?.[0].toLowerCase() ?? null;
}

export function isValidEmailRecipient(recipient: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) && recipient.length <= 254;
}

export function queueEmailDraft(
  request: QueueEmailDraftRequest,
): PendingEmailDraft {
  if (!isValidEmailRecipient(request.to)) {
    throw new Error("A valid recipient email address is required.");
  }
  if (!request.subject.trim() || !request.body.trim()) {
    throw new Error("The email subject and body are required.");
  }

  const sourceRowCount = request.sourceRowCount ?? 0;
  if (
    !Number.isInteger(sourceRowCount) ||
    sourceRowCount < 0 ||
    sourceRowCount > MAX_EMAIL_SOURCE_ROWS
  ) {
    throw new Error(
      `Email source data must contain between 0 and ${MAX_EMAIL_SOURCE_ROWS} rows.`,
    );
  }

  const now = request.now ?? new Date();
  const id = request.id ?? randomUUID().split("-")[0];
  const draft: PendingEmailDraft = {
    id,
    userId: request.userId,
    to: request.to.toLowerCase(),
    subject: request.subject.trim(),
    body: request.body.trim(),
    status: "pending_approval",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EMAIL_APPROVAL_TTL_MS).toISOString(),
    sourceRowCount,
    messageId: null,
  };
  drafts.set(id, draft);
  return draft;
}

export function getEmailDraft(id: string): PendingEmailDraft | null {
  return drafts.get(id) ?? null;
}

export function clearEmailDrafts(): void {
  drafts.clear();
}

function approvalCommand(id: string): string {
  return `APPROVE EMAIL ${id}`;
}

function cancelCommand(id: string): string {
  return `CANCEL EMAIL ${id}`;
}

export function formatEmailDraftPreview(draft: PendingEmailDraft): string {
  return [
    "EMAIL DRAFT - PENDING APPROVAL",
    `Draft ID: ${draft.id}`,
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    "",
    draft.body,
    "",
    "Nothing has been sent.",
    "To send, reply exactly:",
    approvalCommand(draft.id),
    "",
    "To discard this draft:",
    cancelCommand(draft.id),
  ].join("\n");
}

function ownedDraft(id: string, userId: string): PendingEmailDraft {
  const draft = drafts.get(id);
  if (!draft || draft.userId !== userId) {
    throw new Error("That email draft was not found for this user.");
  }
  return draft;
}

export async function approveEmailDraft(
  id: string,
  userId: string,
  sender: EmailSender = sendEmailWithSmtp,
  now = new Date(),
): Promise<{ draft: PendingEmailDraft; receipt: EmailDeliveryReceipt }> {
  const draft = ownedDraft(id, userId);
  if (draft.status !== "pending_approval") {
    throw new Error(`That email draft is already ${draft.status.replace("_", " ")}.`);
  }
  if (now.getTime() > new Date(draft.expiresAt).getTime()) {
    draft.status = "cancelled";
    throw new Error("That email approval has expired. Create a new draft.");
  }

  draft.status = "sending";
  try {
    const receipt = await sender({
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
    });
    draft.status = "sent";
    draft.messageId = receipt.messageId;
    return { draft, receipt };
  } catch (error) {
    draft.status = "pending_approval";
    throw error;
  }
}

export function cancelEmailDraft(id: string, userId: string): PendingEmailDraft {
  const draft = ownedDraft(id, userId);
  if (draft.status !== "pending_approval") {
    throw new Error(`That email draft is already ${draft.status.replace("_", " ")}.`);
  }
  draft.status = "cancelled";
  return draft;
}

export async function handleEmailWorkflowCommand(
  query: string,
  userId: string,
  options: { sender?: EmailSender; now?: Date } = {},
): Promise<EmailWorkflowCommandResult> {
  const normalized = query.replace(/\s+/g, " ").trim();
  const approve = normalized.match(/^APPROVE EMAIL ([a-z0-9-]+)$/i);
  const cancel = normalized.match(/^CANCEL EMAIL ([a-z0-9-]+)$/i);
  if (!approve && !cancel) return { handled: false };

  try {
    if (approve) {
      const { draft } = await approveEmailDraft(
        approve[1],
        userId,
        options.sender,
        options.now,
      );
      return {
        handled: true,
        draft,
        message: `Email sent to ${draft.to}. Subject: ${draft.subject}`,
      };
    }

    const draft = cancelEmailDraft(cancel![1], userId);
    return {
      handled: true,
      draft,
      message: `Email draft ${draft.id} was cancelled. Nothing was sent.`,
    };
  } catch (error) {
    return {
      handled: true,
      message: error instanceof Error ? error.message : "Email action failed.",
    };
  }
}
