import { closeDatabase } from "./database.ts";
import { answerMarketQuestion } from "./marketStatisticsAgent.ts";

const question = process.argv.slice(2).join(" ").trim();

if (!question) {
  console.error('Usage: npm run week5:market -- "What is the average price per sq ft in Pasadena?"');
  process.exit(1);
}

try {
  const result = await answerMarketQuestion(question);
  console.log(result.message);
} finally {
  await closeDatabase();
}
