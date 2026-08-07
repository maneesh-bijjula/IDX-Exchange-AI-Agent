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
      `   Comp validation: ${compDetails}`,
      `   ${preview(listing.remarks)}`,
    ].join("\n");
  });

  return [
    `Top ${response.recommendations.length} recommendations similar to ${targetAddress}:`,
    "",
    ...formatted.flatMap((item, index) =>
      index === formatted.length - 1 ? [item] : [item, ""],
    ),
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
