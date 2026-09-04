---
name: idx-multi-agent-orchestrator
description: Route IDX real estate requests from WhatsApp through the coordinator for property search, market statistics, recommendations, grounded knowledge, and approval-gated email workflows.
---

Use this as the single entry point for IDX Exchange real estate messages. The coordinator classifies each request and routes it to one or more of five agents:

- `propertySearchAgent`
- `marketStatsAgent`
- `recommendationAgent`
- `ragAgent`
- `emailDraftAgent`

The local coordinator bridge runs at:

```txt
http://127.0.0.1:3125/message
```

Call it with the exact user message and a stable sender ID:

```bash
curl -s http://127.0.0.1:3125/message \
  -H 'Content-Type: application/json' \
  -d '{"userId":"whatsapp-demo-user","message":"Find affordable homes in Pasadena and tell me whether prices are rising"}'
```

Reply with the JSON `response` field only. Do not rewrite, shorten, or add facts. The bridge preserves the structured property-search session and the most recent unified response for follow-up searches and email-draft requests.

Mixed requests run the required specialist agents in parallel and merge their output. For example:

```txt
Find me affordable homes in Pasadena and tell me whether prices are rising.
```

routes to both property search and market statistics. A request such as:

```txt
Draft an email summarizing the Pasadena market.
```

routes to market statistics and then the email-draft agent.

Week 11 recipient-addressed drafts are queued with `pending_approval` status. The
coordinator returns the complete preview and a one-time command in this form:

```txt
APPROVE EMAIL <draft-id>
```

Relay the approval command unchanged. Never infer approval from conversational
language, and never send while a draft is only being created or previewed. A draft
can also be discarded with `CANCEL EMAIL <draft-id>`.

Before live use, start the WhatsApp communication bridge from the repository with:

```bash
npm run week11:bridge
```

OpenClaw owns the native WhatsApp typing-indicator lifecycle while the request is
running. The communication handler returns channel-safe text and preserves a clear
user-facing message when an agent fails.
