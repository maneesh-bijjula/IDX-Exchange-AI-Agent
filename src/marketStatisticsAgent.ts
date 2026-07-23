import {
  formatMarketSummary,
  getMarketSummary,
  type MarketAnalyticsOptions,
  type MarketSummary,
} from "./marketAnalytics.ts";
import { parseMarketQuestion, type ParsedMarketQuestion } from "./marketQuestionParser.ts";

export type MarketStatisticsResponse = {
  message: string;
  parsedQuestion: ParsedMarketQuestion;
  summary: MarketSummary | null;
};

export async function answerMarketQuestion(
  question: string,
  options: Pick<MarketAnalyticsOptions, "executor"> = {},
): Promise<MarketStatisticsResponse> {
  const parsedQuestion = parseMarketQuestion(question);

  if (!parsedQuestion.city && !parsedQuestion.zip) {
    return {
      message: "Which California city or ZIP should I analyze?",
      parsedQuestion,
      summary: null,
    };
  }

  const summary = await getMarketSummary({
    city: parsedQuestion.city,
    zip: parsedQuestion.zip,
    months: parsedQuestion.months,
    executor: options.executor,
  });

  return {
    message: formatMarketSummary(summary),
    parsedQuestion,
    summary,
  };
}
