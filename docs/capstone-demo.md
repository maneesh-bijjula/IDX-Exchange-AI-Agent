# Capstone demo walkthrough

This walkthrough records the successful WhatsApp message sequence validated on September 11, 2026. It demonstrates all five capstone stages. Results reflect the imported MLS snapshot and saved indexes, so later runs can return different numbers or fewer recent comps.

## Preparation

Configure the local MySQL connection, saved semantic and RAG indexes, OpenClaw relay, and email transport as described in the [README](../README.md). From the project directory, start the persistent bridge:

```bash
npm run week11:bridge
```

The Week 11 command runs the shared coordinator used by the final capstone. Keep it running during the demo. Open WhatsApp and the recipient's email inbox. Send `reset` in WhatsApp and wait for the search-reset response before beginning. OpenClaw's `/new` command is separate from the application search reset.

## 1. Mixed property search and market analysis

```text
I’m relocating and looking for 2-bedroom condos in San Diego under $900k. Find some options and tell me how the available inventory compares with sales over the last 12 months.
```

The coordinator runs property search and market statistics in parallel and returns labeled sections. During validation it returned three condo listings and a San Diego market summary with 2,150 active listings, 4,159 sales, and 6.2 months of supply. The condo/budget filters apply to the property search; the accompanying market summary describes the citywide scope.

## 2. Refine the same search

```text
I need more space. Only show options with at least 1200 sqft and 2 baths.
```

Stay in the same conversation. The application retains San Diego, the condo type, the $900,000 maximum price, and the minimum bedroom count, then adds minimum area and bathroom constraints. The validated results all met the new thresholds.

## 3. Semantic search and hybrid recommendations

```text
Find me a peaceful mountain home with a cozy fireplace and a deck for outdoor entertaining.
```

Point out the ranked descriptions and district labels. The saved listing index is searched using embeddings and cosine similarity. Similarity percentages describe vector similarity, not measured search accuracy.

The demonstrated results included `33348 Robin Drive`. Select that indexed address with the explicit follow-up:

```text
Recommend homes like 33348 Robin Drive.
```

Verify the response heading names the intended address. Explain the structured and semantic score components, then distinguish ranking from sold-comp evidence. In the validated response, the top similarity match had insufficient comps, while other recommendations had low, medium, or high count-based confidence. Comp-supported prices are informational estimates.

If a refreshed index no longer contains this property, use an exact address from the current semantic results in the same sentence pattern. Semantic results do not currently populate the structured-search `lastResults` state, so an ordinal alone can refer to an earlier structured search.

## 4. Grounded knowledge answer

```text
What does the list-to-close ratio tell us about a buyer’s negotiating position?
```

The RAG agent retrieves document passages and generates a concise answer with citations. During validation the response cited the Real Estate Data Analyst Primer and Week 5 Market Summaries. Highlight the supporting references rather than reading the entire answer.

Use this verified wording for the demo. The earlier phrase "below 100%" also activated the budget-search rule; that routing limitation is documented in the [reflection](reflection.md).

## 5. Email draft, approval, and receipt

Replace the example recipient below with an inbox you control before sending the request:

```text
Draft a weekly market report for San Diego to buyer@example.com
```

Review the recipient, subject, report period, and pending status. Creating the draft does not send it. The recorded report covered the latest available seven-day period ending June 15, 2026, with 138 closed sales.

To send the reviewed draft, copy its newly generated approval command:

```text
APPROVE EMAIL <new-draft-id>
```

The same user must approve the draft. After WhatsApp reports a successful send, open the newest report in the recipient's inbox. This preview-to-approval-to-receipt flow was verified during the live validation. Each new run creates a different draft ID; previous approval commands must not be reused.

To discard a pending draft instead:

```text
CANCEL EMAIL <new-draft-id>
```

## Supporting material

- [Architecture and final scope](../README.md#architecture-flow)
- [Schema and field-usage notes](schema-notes.md)
- [Reflection and future improvements](reflection.md)

A backup demo recording is not included. This written walkthrough documents the validated sequence; it does not substitute for a recording.
