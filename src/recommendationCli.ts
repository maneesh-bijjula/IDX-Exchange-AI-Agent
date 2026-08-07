import { closeDatabase } from "./database.ts";
import { answerRecommendationQuery } from "./recommendationAgent.ts";

const reference = process.argv.slice(2).join(" ").trim();

if (!reference) {
  console.error(
    'Usage: npm run week7:recommend -- "recommend homes like 33348 Robin Drive"',
  );
  process.exit(1);
}

try {
  const response = await answerRecommendationQuery(reference);
  console.log(response.message);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
