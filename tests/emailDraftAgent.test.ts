import assert from "node:assert/strict";
import test from "node:test";

import { draftEmailSummary } from "../src/emailDraftAgent.ts";
import { clearEmailDrafts, getEmailDraft } from "../src/emailApprovalWorkflow.ts";

test.beforeEach(() => clearEmailDrafts());

test("drafts a formatted market email from agent output", async () => {
  const draft = await draftEmailSummary({
    query: "Draft an email about the Pasadena market",
    sections: [
      { title: "Market Statistics", message: "Median close price: $1,100,000" },
    ],
  });

  assert.equal(draft.subject, "Pasadena Market Update");
  assert.match(draft.message, /^Subject: Pasadena Market Update/);
  assert.match(draft.message, /Median close price: \$1,100,000/);
  assert.match(draft.message, /Best,\nIDX Exchange/);
});

test("can draft from the previous orchestrator response", async () => {
  const draft = await draftEmailSummary({
    query: "Email these results",
    previousResponse: "Three active Irvine listings were found.",
  });

  assert.equal(draft.subject, "Real Estate Update");
  assert.match(draft.message, /Three active Irvine listings were found/);
});

test("keeps the city in a summarized market email subject", async () => {
  const draft = await draftEmailSummary({
    query: "Draft an email summarizing the Pasadena market",
    sections: [{ title: "Market Statistics", message: "Market data" }],
  });
  assert.equal(draft.subject, "Pasadena Market Update");
});

test("asks for source material when no summary exists", async () => {
  const draft = await draftEmailSummary({ query: "Draft an email" });
  assert.equal(draft.subject, null);
  assert.match(draft.message, /need property results or a market summary/i);
});

test("queues a recipient-addressed draft for explicit approval", async () => {
  const draft = await draftEmailSummary({
    query: "Draft a weekly Irvine market report to buyer@example.com",
    userId: "email-owner",
    sections: [{ title: "Weekly Market Report", message: "Closed sales: 12" }],
  });

  assert.equal(draft.to, "buyer@example.com");
  assert.equal(draft.subject, "Irvine Weekly Market Report");
  assert.equal(draft.status, "pending_approval");
  assert.ok(draft.approvalId);
  assert.equal(getEmailDraft(draft.approvalId!)?.userId, "email-owner");
  assert.match(draft.message, /Nothing has been sent/);
  assert.match(draft.message, new RegExp(`APPROVE EMAIL ${draft.approvalId}`));
});
