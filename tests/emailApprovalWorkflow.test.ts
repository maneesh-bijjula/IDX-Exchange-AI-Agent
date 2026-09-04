import assert from "node:assert/strict";
import test from "node:test";

import {
  approveEmailDraft,
  cancelEmailDraft,
  clearEmailDrafts,
  extractEmailRecipient,
  formatEmailDraftPreview,
  getEmailDraft,
  handleEmailWorkflowCommand,
  MAX_EMAIL_SOURCE_ROWS,
  queueEmailDraft,
} from "../src/emailApprovalWorkflow.ts";
import { readEmailTransportConfig, type EmailSender } from "../src/emailTransport.ts";

test.beforeEach(() => clearEmailDrafts());

function queuedDraft(id = "draft123", userId = "owner") {
  return queueEmailDraft({
    id,
    userId,
    to: "buyer@example.com",
    subject: "Irvine Weekly Market Report",
    body: "Seven-day market summary",
    sourceRowCount: 1,
    now: new Date("2026-09-04T00:00:00.000Z"),
  });
}

test("extracts and normalizes a recipient from an email request", () => {
  assert.equal(
    extractEmailRecipient("Draft the report to Buyer.Name+IDX@Example.COM"),
    "buyer.name+idx@example.com",
  );
  assert.equal(extractEmailRecipient("Draft the report without a recipient"), null);
});

test("queues a preview without invoking outbound email", () => {
  let sends = 0;
  const unusedSender: EmailSender = async () => {
    sends += 1;
    return { messageId: "unexpected" };
  };
  void unusedSender;

  const draft = queuedDraft();
  const preview = formatEmailDraftPreview(draft);

  assert.equal(sends, 0);
  assert.equal(draft.status, "pending_approval");
  assert.match(preview, /Nothing has been sent/);
  assert.match(preview, /APPROVE EMAIL draft123/);
  assert.match(preview, /CANCEL EMAIL draft123/);
});

test("requires an exact approval command before sending", async () => {
  const draft = queuedDraft();
  let sends = 0;
  const sender: EmailSender = async (email) => {
    sends += 1;
    assert.equal(email.to, "buyer@example.com");
    return { messageId: "message-1" };
  };

  const ignored = await handleEmailWorkflowCommand(
    `Please approve email ${draft.id}`,
    "owner",
    { sender },
  );
  assert.equal(ignored.handled, false);
  assert.equal(sends, 0);

  const approved = await handleEmailWorkflowCommand(
    `APPROVE EMAIL ${draft.id}`,
    "owner",
    { sender, now: new Date("2026-09-04T01:00:00.000Z") },
  );
  assert.equal(approved.handled, true);
  assert.match(approved.message ?? "", /Email sent to buyer@example.com/);
  assert.equal(sends, 1);
  assert.equal(getEmailDraft(draft.id)?.status, "sent");
});

test("rejects approval from a different user", async () => {
  const draft = queuedDraft();
  let sends = 0;
  const result = await handleEmailWorkflowCommand(
    `APPROVE EMAIL ${draft.id}`,
    "different-user",
    {
      sender: async () => {
        sends += 1;
        return { messageId: "unsafe" };
      },
    },
  );

  assert.equal(result.handled, true);
  assert.match(result.message ?? "", /not found for this user/);
  assert.equal(sends, 0);
  assert.equal(getEmailDraft(draft.id)?.status, "pending_approval");
});

test("allows one send only", async () => {
  const draft = queuedDraft();
  let sends = 0;
  const sender: EmailSender = async () => {
    sends += 1;
    return { messageId: `message-${sends}` };
  };

  await approveEmailDraft(
    draft.id,
    "owner",
    sender,
    new Date("2026-09-04T01:00:00.000Z"),
  );
  await assert.rejects(
    approveEmailDraft(
      draft.id,
      "owner",
      sender,
      new Date("2026-09-04T02:00:00.000Z"),
    ),
    /already sent/,
  );
  assert.equal(sends, 1);
});

test("cancelled and expired drafts cannot be sent", async () => {
  const cancelled = queuedDraft("cancel123");
  cancelEmailDraft(cancelled.id, "owner");
  await assert.rejects(
    approveEmailDraft(cancelled.id, "owner", async () => ({ messageId: "unsafe" })),
    /already cancelled/,
  );

  const expired = queuedDraft("expired123");
  await assert.rejects(
    approveEmailDraft(
      expired.id,
      "owner",
      async () => ({ messageId: "unsafe" }),
      new Date("2026-09-06T00:00:00.000Z"),
    ),
    /expired/,
  );
  assert.equal(getEmailDraft(expired.id)?.status, "cancelled");
});

test("enforces the 50-row outbound data limit", () => {
  assert.throws(
    () =>
      queueEmailDraft({
        userId: "owner",
        to: "buyer@example.com",
        subject: "Too much data",
        body: "Unsafe export",
        sourceRowCount: MAX_EMAIL_SOURCE_ROWS + 1,
      }),
    /between 0 and 50 rows/,
  );
});

test("reports missing SMTP configuration without exposing supplied secrets", () => {
  const secret = "do-not-print-this-password";
  assert.throws(
    () => readEmailTransportConfig({ EMAIL_PASSWORD: secret }),
    (error: Error) => {
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.match(error.message, /not configured/);
      return true;
    },
  );
});
