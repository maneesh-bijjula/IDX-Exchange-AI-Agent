import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIDGE_UNAVAILABLE_MESSAGE,
  createWhatsappRelayHandler,
  resolveRelayConfig,
  resolveRelayUserId,
  shouldRelayWhatsappMessage,
} from "../openclaw-plugin/idx-whatsapp-relay/relay.ts";

const whatsappContext = {
  messageProvider: "whatsapp",
  senderId: "+18582411191",
};

test("relays permitted WhatsApp messages and preserves coordinator text", async () => {
  const handler = createWhatsappRelayHandler(
    resolveRelayConfig({ allowedSender: "+18582411191" }),
    {
      fetcher: async (_url, init) => {
        assert.deepEqual(JSON.parse(String(init?.body)), {
          userId: "+18582411191",
          message: "Draft an email from these results",
        });
        return {
          ok: true,
          json: async () => ({ response: "Subject: Property Update\n\nHi," }),
        };
      },
    },
  );

  const result = await handler(
    { cleanedBody: "Draft an email from these results" },
    whatsappContext,
  );

  assert.equal(result?.handled, true);
  assert.equal(result?.reply?.text, "Subject: Property Update\n\nHi,");
});

test("uses the WhatsApp sender as the stable approval owner", () => {
  assert.equal(
    resolveRelayUserId(whatsappContext, "whatsapp-demo-user"),
    "+18582411191",
  );
  assert.equal(resolveRelayUserId({}, "whatsapp-demo-user"), "whatsapp-demo-user");
});

test("does not intercept slash commands or unrelated channels", () => {
  assert.equal(
    shouldRelayWhatsappMessage("/new", whatsappContext, "+18582411191"),
    false,
  );
  assert.equal(
    shouldRelayWhatsappMessage(
      "Find homes in Irvine",
      { messageProvider: "telegram", senderId: "+18582411191" },
      "+18582411191",
    ),
    false,
  );
});

test("does not intercept a different WhatsApp sender", () => {
  assert.equal(
    shouldRelayWhatsappMessage(
      "Find homes in Irvine",
      { messageProvider: "whatsapp", senderId: "+15555550100" },
      "+18582411191",
    ),
    false,
  );
});

test("returns a clear deterministic response when the coordinator is unavailable", async () => {
  const handler = createWhatsappRelayHandler(resolveRelayConfig(), {
    fetcher: async () => {
      throw new Error("connection refused");
    },
  });

  const result = await handler({ cleanedBody: "What does DOM mean?" }, whatsappContext);
  assert.equal(result?.handled, true);
  assert.equal(result?.reply?.text, BRIDGE_UNAVAILABLE_MESSAGE);
});

test("preserves a user-facing orchestration error from the communication layer", async () => {
  const handler = createWhatsappRelayHandler(resolveRelayConfig(), {
    fetcher: async () => ({
      ok: false,
      json: async () => ({
        response: "Sorry, I hit an issue while processing that request. Please try again.",
      }),
    }),
  });

  const result = await handler({ cleanedBody: "Show Irvine homes" }, whatsappContext);
  assert.equal(result?.handled, true);
  assert.equal(
    result?.reply?.text,
    "Sorry, I hit an issue while processing that request. Please try again.",
  );
});
