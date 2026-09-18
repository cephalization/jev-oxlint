/**
 * Nightly job: push the human review panel's verdicts back onto the spans they
 * were collected for, so reviewers can see each other's calls in Phoenix.
 */
import { createClient } from "@arizeai/phoenix-client";
import { addSpanAnnotation } from "@arizeai/phoenix-client/spans";

import { loadReviewQueue } from "./reviewQueue.js";

const client = createClient();

export interface PanelVerdict {
  spanId: string;
  reviewerId: string;
  label: "high_quality" | "low_quality";
  score: number;
  explanation: string;
}

async function publishPanelVerdicts(verdicts: PanelVerdict[]): Promise<void> {
  for (const verdict of verdicts) {
    await addSpanAnnotation({
      client,
      spanAnnotation: {
        spanId: verdict.spanId,
        name: "answer_quality",
        annotatorKind: "HUMAN",
        label: verdict.label,
        score: verdict.score,
        explanation: verdict.explanation,
        metadata: { reviewer: verdict.reviewerId },
      },
      sync: true,
    });
  }
}

async function main(): Promise<void> {
  // Every span in the queue is graded by three reviewers; all three verdicts
  // are supposed to remain visible side by side in the Phoenix UI.
  const verdicts = await loadReviewQueue();
  await publishPanelVerdicts(verdicts);
  console.log(`published ${verdicts.length} verdicts`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
