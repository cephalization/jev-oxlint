/**
 * LLM-as-judge sweep: score the most recent agent spans for correctness and
 * write the result back. Re-running the sweep is expected to refresh the score
 * for each span rather than add a second one.
 */
import { openai } from "@ai-sdk/openai";
import { getSpans, logSpanAnnotations } from "@arizeai/phoenix-client/spans";
import { createClassificationEvaluator } from "@arizeai/phoenix-evals";

import "dotenv/config";

const EVAL_NAME = "correctness";
const PROJECT_NAME = process.env.PHOENIX_PROJECT_NAME ?? "support-agent";

interface SpanLike {
  name?: string;
  attributes?: Record<string, unknown>;
  context?: { span_id?: string };
}

const evaluator = createClassificationEvaluator({
  name: EVAL_NAME,
  model: openai("gpt-4o-mini"),
  choices: { correct: 1, incorrect: 0 },
  promptTemplate: "Is the answer correct?\n{input}\n{output}",
});

async function main(): Promise<void> {
  const { spans } = await getSpans({ project: { projectName: PROJECT_NAME }, limit: 200 });

  const cases = (spans as unknown as SpanLike[]).flatMap((span) => {
    const spanId = span.context?.span_id;
    const input = span.attributes?.["input.value"];
    const output = span.attributes?.["output.value"];
    if (!spanId || typeof input !== "string" || typeof output !== "string") return [];
    return [{ spanId: String(spanId), input, output }];
  });

  const spanAnnotations = await Promise.all(
    cases.map(async ({ spanId, input, output }) => {
      const result = await evaluator.evaluate({ input, output });
      return {
        spanId,
        name: EVAL_NAME,
        label: result.label,
        score: result.score,
        explanation: result.explanation ?? undefined,
        annotatorKind: "LLM" as const,
        metadata: { evaluator: EVAL_NAME },
      };
    }),
  );

  await logSpanAnnotations({ spanAnnotations, sync: true });
  console.log(`wrote ${spanAnnotations.length} ${EVAL_NAME} annotations`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
