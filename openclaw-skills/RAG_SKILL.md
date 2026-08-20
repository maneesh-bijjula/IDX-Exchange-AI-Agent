---
name: idx-real-estate-knowledge
description: Answer real estate terminology and MLS schema questions using the indexed Week 8 IDX Exchange knowledge sources.
---

Use this skill when the user asks a conceptual or definitional real estate question, asks what an MLS field means, or asks which columns are present in `rets_property` or `california_sold`.

Run this from the IDX Exchange AI Agent repo:

```bash
npm run week8:ask -- "EXACT_USER_MESSAGE"
```

Reply with the complete command output only. Preserve inline citations and the final `Sources:` section. Do not add facts from general knowledge or remove the source labels.

Use this skill for requests such as:

- `What does DOM mean?`
- `What columns are in california_sold?`
- `What is a list-to-close ratio?`
- `What does L_SystemPrice mean in rets_property?`
- `How is StandardStatus defined?`

This route is for knowledge questions. Property searches belong to the Week 4 or Week 6 skills, market calculations belong to Week 5, and recommendations based on a named listing belong to Week 7.

The local RAG index must exist. Build or refresh it with:

```bash
npm run week8:index
```

If the command reports that the index is missing, tell the user to build the Week 8 index. Do not replace the indexed answer with an unsupported response.
