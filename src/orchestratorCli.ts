import { closeDatabase } from "./database.ts";
import { orchestrate } from "./orchestrator.ts";

const args = process.argv.slice(2);
const userIdArgument = args.find((argument) => argument.startsWith("--user-id="));
const userId = userIdArgument?.slice("--user-id=".length).trim() || "local-demo-user";
const query = args
  .filter((argument) => argument !== userIdArgument)
  .join(" ")
  .trim();

if (!query) {
  console.error(
    'Usage: npm run week9:orchestrate -- --user-id=demo "Find homes in Pasadena and tell me whether prices are rising"',
  );
  process.exit(1);
}

try {
  const result = await orchestrate(query, userId);
  console.log(result.response);
} catch (error) {
  const nested = error instanceof AggregateError ? error.errors[0] : null;
  console.error(
    error instanceof Error && error.message
      ? error.message
      : nested instanceof Error
        ? nested.message
        : String(error),
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
