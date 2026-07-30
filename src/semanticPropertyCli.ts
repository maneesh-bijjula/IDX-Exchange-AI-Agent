import { answerSemanticPropertyQuery } from "./semanticPropertyAgent.ts";

const query = process.argv.slice(2).join(" ").trim();

if (!query) {
  console.error(
    'Usage: npm run week6:search -- "charming craftsman with mountain views and character"',
  );
  process.exit(1);
}

try {
  const result = await answerSemanticPropertyQuery(query);
  console.log(result.message);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
