/**
 * Nightly job: push the human review panel's verdicts back onto the spans they
 * were collected for. One annotation per reviewer per span, all kept.
 */
import { createClient } from "@arizeai/phoenix-client";
import { logSpanAnnotations } from "@arizeai/phoenix-client/spans";

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
  const spanAnnotations = verdicts.map((verdict) => ({
    spanId: verdict.spanId,
    name: "answer_quality",
    annotatorKind: "HUMAN" as const,
    // One slot per reviewer: re-running the job updates that reviewer's row
    // and leaves the other reviewers' annotations untouched.
    identifier: verdict.reviewerId,
    label: verdict.label,
    score: verdict.score,
    explanation: verdict.explanation,
    metadata: { reviewer: verdict.reviewerId },
  }));

  await logSpanAnnotations({ client, spanAnnotations, sync: true });
}

async function main(): Promise<void> {
  const verdicts = await loadReviewQueue();
  await publishPanelVerdicts(verdicts);
  console.log(`published ${verdicts.length} verdicts`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
