---
name: idx-market-statistics
description: Answer California market analytics questions with the local IDX Exchange Week 5 market statistics agent.
---

Use this skill when the user asks about market statistics, sold comps, median price, average price, price per square foot, days on market, list-to-close ratio, inventory, or price trends for a California city or ZIP.

The Week 5 market statistics agent is implemented in:

```txt
src/marketStatisticsAgent.ts
```

For a direct local answer, run this from the repo:

```bash
npm run week5:market -- "What is the average price per sq ft in Pasadena?"
```

Reply to the user with the returned `message` text only. The response is backed by `california_sold` for closed-sale metrics and `rets_property` for current active inventory.

Supported examples:

- `Is now a good time to buy in San Diego?`
- `What is the average price per sq ft in Pasadena?`
- `Show Irvine median price and days on market over the last 12 months`
- `Compare active inventory vs sold volume in Newport Beach`
- `What is the 24 month trend for San Diego?`
