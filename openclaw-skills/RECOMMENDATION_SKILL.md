---
name: idx-property-recommendations
description: Recommend five active listings similar to a specific listing using hybrid structured and semantic scoring with sold-comp validation.
---

Use this skill when the user names a specific listing ID or street address and asks for similar properties, recommendations, alternatives, or homes like that listing.

This Week 7 route takes priority over Week 6 semantic search when a specific property is the reference point. Requests that only describe general preferences without naming a listing still belong to Week 6.

Run this from the IDX Exchange AI Agent repo:

```bash
npm run week7:recommend -- "EXACT_USER_MESSAGE"
```

Reply with stdout beginning with `Top` only. Preserve every recommendation and every `Hybrid score:`, `Why it matches:`, and `Market evidence:` line exactly. Each available `Market evidence:` line must retain its price estimate, recent-sale count, above/below assessment, and confidence. Keep the informational-estimate disclaimer. Do not invent recommendations or pricing data.

Use this skill for requests such as:

- `Recommend homes like 33348 Robin Drive`
- `Show similar listings to 1801 Bernina Drive`
- `I like MLS listing 1106956808. Find five alternatives.`

The local Week 6 semantic index must exist because Week 7 reuses its listing embeddings. If the target is not indexed, return the command's error and ask the user for an indexed listing ID or address.
