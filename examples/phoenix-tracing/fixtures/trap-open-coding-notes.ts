/**
 * Open-coding pass: a reviewer leaves free-form observations on recent spans
 * and sets a single triage status per span. No rubric exists yet.
 */
import { createClient } from "@arizeai/phoenix-client";
import { addSpanAnnotation, addSpanNote, getSpans } from "@arizeai/phoenix-client/spans";

import { collectObservations, triage } from "./openCoding.js";

const client = createClient();

interface SpanLike {
  context?: { span_id?: string };
  span_id?: string;
  attributes?: Record<string, unknown>;
}

function spanIdOf(span: SpanLike): string | undefined {
  const raw = span.context?.span_id ?? span.span_id;
  return raw != null ? String(raw) : undefined;
}

async function openCode(projectName: string): Promise<void> {
  const { spans } = await getSpans({ client, project: { projectName }, limit: 50 });

  for (const span of spans as unknown as SpanLike[]) {
    const spanId = spanIdOf(span);
    if (!spanId) continue;

    // Many qualitative observations per span: notes are append-only, each call
    // gets its own generated identifier, so they stack up rather than replace.
    for (const observation of collectObservations(span.attributes ?? {})) {
      await addSpanNote({ client, spanNote: { spanId, note: observation } });
    }

    // Exactly one triage status per span; re-running the pass is meant to
    // update that status in place.
    const status = triage(span.attributes ?? {});
    await addSpanAnnotation({
      client,
      spanAnnotation: {
        spanId,
        name: "triage_status",
        annotatorKind: "HUMAN",
        label: status.label,
        score: status.score,
      },
      sync: true,
    });
  }
}

openCode(process.env.PHOENIX_PROJECT_NAME ?? "support-agent").catch((error) => {
  console.error(error);
  process.exit(1);
});
