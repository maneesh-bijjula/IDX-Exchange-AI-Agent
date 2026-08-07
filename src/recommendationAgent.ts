import {
  recommendSimilarListings,
  type RecommendationOptions,
  type RecommendationResponse,
} from "./recommendationEngine.ts";

function money(value: number | null): string {
  return value == null ? "unavailable" : `$${value.toLocaleString("en-US")}`;
}

function preview(text: string, maxLength = 180): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function matchReasons(
  target: RecommendationResponse["target"],
  result: RecommendationResponse["recommendations"][number],
): string {
  const reasons: string[] = [];
  if (
    result.score.pricePoints > 0 &&
    target.price != null &&
    result.listing.price != null
  ) {
    reasons.push(
      `$${Math.abs(target.price - result.listing.price).toLocaleString("en-US")} price difference`,
    );
  }
  if (result.score.bedsPoints > 0) reasons.push("same bedroom count");
  if (result.score.cityPoints > 0) reasons.push("same city");
  if (
    result.score.sqftPoints > 0 &&
    target.sqft != null &&
    result.listing.sqft != null
  ) {
    reasons.push(
      `${Math.abs(target.sqft - result.listing.sqft).toLocaleString("en-US")} sqft difference`,
    );
  }
  reasons.push(
    `${(result.score.semanticSimilarity * 100).toFixed(1)}% semantic similarity`,
  );
  return reasons.join("; ");
}

export function formatRecommendationResponse(
  response: RecommendationResponse,
): string {
  const targetAddress = response.target.address ?? response.target.id;
  if (response.recommendations.length === 0) {
    return `No comparable active listings were found for ${targetAddress}.`;
  }

  const formatted = response.recommendations.map((result, index) => {
    const { listing, score, compValidation } = result;
    const location = [listing.city, listing.zip].filter(Boolean).join(", ");
    const details = [
      listing.beds == null
        ? null
        : `${listing.beds} ${listing.beds === 1 ? "bed" : "beds"}`,
      listing.baths == null
        ? null
        : `${listing.baths} ${listing.baths === 1 ? "bath" : "baths"}`,
      listing.sqft == null ? null : `${listing.sqft.toLocaleString("en-US")} sqft`,
    ].filter((value): value is string => value != null);
    const compDetails =
      compValidation.estimatedCompPrice == null
        ? compValidation.assessment
        : `${money(compValidation.estimatedCompPrice)} estimate from ${compValidation.compCount.toLocaleString("en-US")} recent sales; ${compValidation.assessment.toLocaleLowerCase()}`;

    return [
      `${index + 1}. ${listing.address ?? "Address unavailable"}${location ? ` - ${location}` : ""} - ${money(listing.price)}`,
      `   ${details.join(" | ")}`,
      `   Hybrid score: ${score.totalScore}/100 (structured ${score.structuredScore}/60 + semantic ${score.semanticScore}/40)`,
      `   Why it matches: ${matchReasons(response.target, result)}`,
      `   Comp validation: ${compDetails}`,
      `   Comp confidence: ${compValidation.confidence} (${compValidation.compCount.toLocaleString("en-US")} recent sales)`,
      `   ${preview(listing.remarks)}`,
    ].join("\n");
  });

  return [
    `Top ${response.recommendations.length} recommendations similar to ${targetAddress}:`,
    "",
    ...formatted.flatMap((item, index) =>
      index === formatted.length - 1 ? [item] : [item, ""],
    ),
    "",
    "Comp-supported prices are informational estimates, not appraisals.",
  ].join("\n");
}

export async function answerRecommendationQuery(
  reference: string,
  options: RecommendationOptions = {},
): Promise<RecommendationResponse & { message: string }> {
  const normalizedReference = reference.replace(/\s+/g, " ").trim();
  if (!normalizedReference) {
    throw new Error("Provide a listing ID or street address to recommend from.");
  }
  const response = await recommendSimilarListings(normalizedReference, options);
  return { ...response, message: formatRecommendationResponse(response) };
}
