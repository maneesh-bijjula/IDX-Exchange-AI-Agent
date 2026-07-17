---
name: idx-property-search
description: Route real estate search messages to the local IDX Exchange Week 4 conversational property search bridge.
---

Use this skill when the user asks to search for real estate listings, refine a home search, compare listing preferences, or continue a property-search conversation.

This workspace has a local IDX Exchange property-search bridge running at:

```txt
http://127.0.0.1:3124/message
```

When a property-search message arrives, call the bridge with the user's message. Use the sender's stable id as `userId` if available; otherwise use `whatsapp-demo-user`.

Example command:

```bash
curl -s http://127.0.0.1:3124/message \
  -H 'Content-Type: application/json' \
  -d '{"userId":"whatsapp-demo-user","message":"Find homes in Irvine"}'
```

The bridge returns JSON with:

- `message`: the exact human-readable reply to send back
- `session`: structured property-search state
- `cards`: formatted property results
- `askedFor`: the missing slot, if the agent is asking a follow-up question

Reply to the user with the returned `message` field. Do not expose raw JSON unless the user asks for debugging details.

The bridge supports multi-turn refinement. For example:

1. User: `Find homes in Irvine`
2. Bridge asks for budget
3. User: `Under $1.2M`
4. Bridge asks for property type or bedrooms
5. User: `single family with 3 beds`
6. Bridge returns active MLS listings from `rets_property`

If the user says `reset`, `restart`, `start over`, or `new search`, call the same bridge; it will clear the structured session and ask for a city.
