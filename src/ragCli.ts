import { answerRagQuestion } from "./ragKnowledge.ts";

const question = process.argv.slice(2).join(" ").trim();

if (!question) {
  console.error('Usage: npm run week8:ask -- "What does DOM mean?"');
  process.exit(1);
}

try {
  const response = await answerRagQuestion(question);
  console.log(response.message);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
