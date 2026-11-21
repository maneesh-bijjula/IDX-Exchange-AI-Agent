# Schema and field-usage notes

This document records how the implemented agents use the imported MLS data. It is a field-usage reference, not a complete dump of either database schema. The application selects its schema through `MYSQL_DATABASE`.

## Data sources and scope

| Source | Recorded imported scope | Application purpose |
| --- | --- | --- |
| `rets_property` | 53,122 rows | Listing search, active inventory, and listing text for embeddings |
| `california_sold` | 87,157 rows | Historical transactions, market summaries, comparable-sale evidence, and weekly reports |
| `property_school_district` | Derived enrichment table | Connect geocoded listings to unified school-district boundaries |

The two imported tables total 140,279 rows. A row in `rets_property` is not necessarily active: search and inventory queries explicitly require `L_Status = 'Active'`. The demonstrated vector index covers 1,000 eligible listings, rather than every imported row. These are recorded internship snapshot counts, not a live data-feed guarantee.

## Active listing fields: `rets_property`

| Field | Meaning and implemented use |
| --- | --- |
| `L_ListingID` | MLS identifier; property-card identity, semantic index identity, and school-district lookup key. Normalized to text for vector and enrichment records. |
| `L_DisplayId` | Human-facing MLS identifier; fallback card identity and alternate recommendation reference. |
| `L_Address` | Display address and explicit address-based recommendation lookup. |
| `L_City`, `L_Zip` | Display location; city search filter; city/ZIP inventory filters; city similarity and comp matching. |
| `L_Status` | Active eligibility check. The implemented search uses this legacy field rather than `StandardStatus`. |
| `L_SystemPrice` | List price in dollars; maximum-budget filter, ascending search order, display, and price-proximity scoring. Aliased to `price` in structured search. |
| `L_Keyword2` | Bedroom count; minimum-bedroom filter, display, and bedroom similarity. Aliased to `beds`. |
| `LM_Dec_3` | Bathroom count, including fractions; minimum-bathroom filter and display. Aliased to `baths`. |
| `LM_Int2_3` | Living area in square feet; minimum-area filter, area similarity, and comp size bands. Aliased to `sqft`. |
| `L_Type_` | Subtype such as `Condominium`, `Townhouse`, or `SingleFamilyResidence`; type filter and display. |
| `L_Remarks` | Listing description used in embedding text. Index creation requires non-empty remarks. |
| `YearBuilt` | Display highlight and semantic document context. |
| `AssociationFee` | HOA fee value; maximum-HOA filter and card highlight. |
| `PoolPrivateYN`, `ViewYN` | Pool/view filters use the imported string value `True`; also used in highlights. |
| `FireplaceYN` | Fireplace highlight on structured property cards. |
| `DaysOnMarket` | Listing-age highlight; separate from sold-transaction DOM used in market analytics. |
| `PhotoCount` | Photo-count highlight. Structured cards do not fetch or display the full `L_Photos` array. |
| `LMD_MP_Latitude`, `LMD_MP_Longitude` | Coordinates selected by search and used by the enrichment script for spatial joins. |
| `LA1_UserFirstName`, `LA1_UserLastName`, `LO1_OrganizationName` | Listing-agent and brokerage labels in property cards. |

Implementation: [property parser](../src/propertyQueryParser.ts), [search queries and cards](../src/mlsSearch.ts), [semantic index](../src/semanticPropertySearch.ts).

User-provided filter values use SQL parameters. Pagination is sanitized to positive integer values; active-search result limits are capped at 50 and inserted as validated numbers into SQL. The conversational interface requests three cards by default. Bedroom and bathroom requests are interpreted as minimums, so a two-bedroom request can also return three-bedroom homes.

## Sold transaction fields: `california_sold`

| Field | Meaning and implemented use |
| --- | --- |
| `ListingKey` | Transaction listing identifier selected by the standalone sold-comps query. |
| `City`, `PostalCode` | Market filters; city also identifies recommendation comp groups and weekly-report scope. |
| `CloseDate` | Closing date; time-window filters, monthly trend buckets, and latest-available weekly-report anchor. Imported as date-like text and used in MySQL date comparisons. |
| `ClosePrice` | Final transaction price; mean/median price, price-per-square-foot calculations, and comp estimates. |
| `ListPrice` | Asking price used as the denominator of the list-to-close ratio. |
| `OriginalListPrice` | Selected by the standalone sold-comps query; not the denominator used by the implemented market ratio. |
| `LivingArea` | Living area in square feet; positive-area checks for price-per-square-foot and size-band matching. |
| `DaysOnMarket` | Historical transaction DOM used in average market and weekly-report metrics. |
| `PropertyType` | Broad class; market and comp queries require `Residential`. |
| `PropertySubType` | Optional subtype filter in market analytics and standalone sold-comps output. |
| `UnparsedAddress`, `BedroomsTotal`, `BathroomsTotalInteger` | Address, bedrooms, and bathrooms for sold-comp cards. |
| `YearBuilt`, `ListAgentFullName`, `ListOfficeName`, `BuyerOfficeName` | Additional fields selected by the standalone sold-comps query; sold-comp cards expose the listing office. |

Implementation: [market analytics](../src/marketAnalytics.ts), [sold-comps query](../src/mlsSearch.ts), [recommendation comp checks](../src/recommendationEngine.ts), [weekly report](../src/weeklyMarketReport.ts).

## Relationships and calculations

The active and sold tables describe different populations. Current recommendation validation matches sold transactions by city and living-area range; it does not join the two tables by listing ID. Treat identifiers as identifiers, not proof that two records represent a suitable comparable sale.

| Metric | Implemented calculation and scope |
| --- | --- |
| Mean and median close price | Arithmetic mean and median of selected `ClosePrice` values. General market analytics computes these in TypeScript. |
| Mean price per square foot | Mean of individual `ClosePrice / LivingArea` ratios for rows with positive living area. |
| Mean days on market | Mean of selected sold `DaysOnMarket` values. |
| List-to-close percentage | Mean of individual `(ClosePrice / ListPrice) * 100` ratios with positive list price. |
| Months of supply | Active count divided by `(selected sold count / requested month count)`. Both counts should be interpreted with their chosen geography/subtype and snapshot dates. |
| Monthly trend | Percentage change between adjacent returned monthly average-price buckets. Missing months are not filled in. |
| Year-over-year trend | Current implementation compares the latest returned bucket with the bucket 12 positions earlier when at least 13 exist. Missing calendar months can affect this interpretation. |
| Comp-supported estimate | Mean sold price per square foot multiplied by the recommended property's area. Comps are residential, in the same city, within 80%-120% of area, and within the last six months. |
| Comp price difference | `(listing price - estimate) / estimate * 100`; a negative value means below the estimate. |
| Comp confidence | Count-based labels: 20+ sales high, 5-19 medium, 1-4 low, none unavailable. These are evidence-volume heuristics, not calibrated probabilities or appraisals. |

General market and recommendation windows use the current database date (`CURDATE()`). The weekly report instead anchors to the selected city's latest residential `CloseDate`, comparing the most recent seven available days with the preceding seven. It returns one SQL aggregate row and labels the period explicitly. With an older dataset, these windows can produce different coverage.

General market responses describe their parsed geographic scope. They do not automatically inherit every filter from a property search in the same message. For example, the demonstrated San Diego condo query produced filtered condo cards alongside a citywide residential market summary.

## School-district enrichment

The Python enrichment script builds `property_school_district` without altering the imported MLS table. It converts valid listing coordinates to points and matches them within California unified school-district polygons.

| Derived column | Purpose |
| --- | --- |
| `listing_id` | Primary key corresponding to `rets_property.L_ListingID`. |
| `latitude`, `longitude` | Coordinates used in the spatial join. |
| `district_name`, `district_type`, `district_cds_code` | Matched district label, unified classification, and identifier. |
| `county_name`, `district_object_id` | Boundary-source county and polygon identity. |
| `boundary_year` | Boundary dataset year retained with each mapping. |
| `matched` | Whether a unified boundary matched; unmatched listings remain explicit. |

Semantic results query matched district rows in a batch. Listings served by separate elementary/high-school districts can remain unmatched because the enrichment intentionally selects only unified districts. The recorded full run processed 52,424 geocoded active listings and matched 40,984 (78.2%).

Implementation: [enrichment script](../scripts/enrich_school_districts.py), [district lookup](../src/schoolDistrict.ts).

## Data handling and limitations

- Decimal values can arrive as strings from the SQL driver. Semantic and comp code normalizes numeric values; some structured card fields preserve the driver's representation.
- Pool/view flags are compared to the imported string `True`; other encodings require normalization before use.
- Comp estimates use city and size bands, without adjustment for every feature, condition, or neighborhood difference.
- SQL result caps are specific to individual paths: active search and standalone sold-comps are capped, but internal market analytics, index-building, and recommendation batch queries can read larger sets. There is no universal 50-row SQL limit.
- The embedding and RAG indexes are local JSON artifacts containing data and vectors; they must be rebuilt to reflect source changes. Generated indexes and credentials are excluded from version control.
- RAG source documents explain field meanings but do not replace the SQL data. The handbook schema supplement covers legacy active-listing names that differ from RESO names.
