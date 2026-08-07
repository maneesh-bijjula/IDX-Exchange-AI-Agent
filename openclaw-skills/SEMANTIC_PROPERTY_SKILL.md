---
name: idx-semantic-property-search
description: Find active California listings that are semantically similar to a free-text property description.
---

Use this skill when the user describes a property's style, atmosphere, setting, features, or character instead of providing only structured filters.

This semantic route takes priority over the Week 4 structured property-search bridge whenever the request contains qualitative preferences such as `charming`, `craftsman`, `mountain views`, `character`, `peaceful`, `modern`, `coastal`, `historic`, or similar descriptive language. Do not send those requests to the Week 4 bridge, even when they begin with `find`, `show`, or `I want`.

The Week 6 semantic property agent is implemented in:

```txt
src/semanticPropertyAgent.ts
```

Run this from the IDX Exchange AI Agent repo:

```bash
npm run week6:search -- "EXACT_USER_MESSAGE"
```

Reply with the command output only. Copy stdout beginning with `Top` verbatim. Do not summarize, rewrite, reorder, shorten, or add an introduction or closing sentence. Preserve every `School district:` line exactly; a semantic-search reply is incomplete if any property is missing that line.

The search embeds the user's description with the same OpenAI embedding model used to build the local listing index, calculates cosine similarity against active `rets_property` listings, and returns the five highest-scoring matches with unified school-district data.

Use this skill for requests such as:

- `Find a charming craftsman with mountain views and character`
- `I want a peaceful modern home surrounded by nature`
- `Show me a bright coastal property with an open layout`
- `Find a historic home with original details and a large garden`

Before the first semantic search, the local index must exist. Build it with:

```bash
npm run week6:index -- --limit 1000
```

If the command reports that the index is missing, tell the user that the Week 6 semantic index needs to be built. Do not replace the data-backed result with a general-knowledge answer.
