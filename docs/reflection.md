# Capstone reflection

## What I learned most

The biggest lesson from this internship was how to connect individual AI capabilities into a complete working application. Property search, semantic retrieval, market analysis, and email composition each had a clear purpose, but integrating them required consistent interfaces, explicit state, and careful handling of dependencies between steps.

The final WhatsApp flow made those engineering decisions visible. A user could search for properties, refine the search, explore descriptive preferences, request alternatives, ask for an explanation, and approve an email report within one interface.

## What worked well

**Building one layer at a time.** The weekly structure established parsing and database access before adding memory, embeddings, recommendations, and orchestration. Typed functions and an injectable query executor made it possible to test behavior without depending on the live database for every check.

**Keeping application state explicit.** Storing city, budget, property type, and other preferences as structured session fields let follow-up messages update only the relevant constraints. During the demo, adding area and bathroom requirements preserved the original San Diego condo search.

**Combining different kinds of evidence.** Structured filters handled concrete requirements, embeddings ranked descriptive matches, and historical sales supported price comparisons. Recommendation responses showed the scoring reasons and comp counts, including cases where data was insufficient.

**Making outbound actions reviewable.** The email agent produced a preview before sending. A separate approval command, ownership check, expiration, and send-status checks established a clear boundary between generating content and delivering it. The live workflow was verified through WhatsApp confirmation and receipt in Gmail.

**Adding geographic context.** The school-district enrichment used coordinates and boundary polygons to attach district information to semantic results. Keeping it in a separate table preserved the imported data and made unmatched districts explicit.

## Challenges and engineering lessons

**Channel integration needed predictable routing.** The general OpenClaw conversation path did not always invoke the intended project logic. A dedicated relay connected permitted WhatsApp messages to the local coordinator and returned its response directly. This made channel behavior easier to trace and test.

**Natural-language patterns have boundaries.** During capstone preparation, a recommendation phrased as a property that "caught my eye" fell back to an earlier structured-search result. The explicit "Recommend homes like [address]" phrasing selected the intended target. Similarly, "below 100%" in a knowledge question also matched the budget parser. The final demo used verified wording; these observations remain useful regression cases for improving routing.

**Historical snapshots need clear dates.** A report based on an imported dataset must explain the period it covers. The weekly report uses the latest available closing date and labels that period, rather than implying that old records describe the current week. General analytics still uses calendar-relative windows, so snapshot age remains a factor in the results.

**Passing unit tests and passing a user workflow are different checks.** The recorded completion suite passed 126 Node tests and three GIS tests. Live testing additionally exposed interaction issues involving state and wording and verified the actual email delivery path. Both levels of validation were valuable.

## What I would change next

1. **Persist sessions and drafts.** Move process-local Maps into durable storage so restarts do not lose preferences or pending approvals, and multiple application instances can share state.
2. **Improve routing and references.** Add the observed ambiguous phrases to regression tests, distinguish numeric concept questions from budgets, and resolve explicit listing references consistently across structured and semantic searches.
3. **Strengthen data freshness and coverage.** Refresh indexes incrementally, display snapshot dates consistently, and expand semantic coverage beyond the 1,000-listing demonstration index.
4. **Refine analytical evidence.** Improve missing-month handling and numeric/null normalization, and evaluate narrower comparable-sale groups where the dataset supports them. Keep count-based confidence labels distinct from formal uncertainty estimates.
5. **Prepare for wider deployment.** Add durable send tracking and delivery reconciliation, stronger service authentication, operational monitoring, and automated full-flow checks before exposing the local bridge beyond its intended environment.

## Outcome

The capstone brought the weekly modules together into an integrated local assistant with a demonstrated WhatsApp-to-email workflow. I gained experience in TypeScript, SQL, embeddings, retrieval, geospatial enrichment, testing, and integration debugging. Most importantly, I learned to make the system's state, data sources, and action boundaries explicit so its behavior could be understood and verified.
