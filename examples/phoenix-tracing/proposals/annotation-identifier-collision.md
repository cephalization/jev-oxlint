# Proposed check: annotation-identifier-collision

Drafted by claude-opus-5 from `references/annotations-typescript.md`. **Review the questions and thresholds before anything else.**

## Summary

Phoenix structured annotations are keyed by (name, target id, identifier), so writing the same triple twice silently overwrites the earlier entry; notes are append-only and never collide. The check anchors on every structured annotation writer imported from @arizeai/phoenix-client/{spans,traces,sessions}, skips deterministically when the inline payload already sets `identifier`, and asks jev one Noul question per remaining write: can two annotations that are meant to coexist land on the same name + target id without a distinct identifier? A finding fires only when P(not uniquely keyed) clears options.threshold.

## Questions to review

- Judging only `code.text`, is every annotation written by this call uniquely keyed — i.e. no two annotations that are meant to coexist can share the same annotation `name`, the same target id, and the same `identifier`?

## Thresholds

Only options.threshold is used: the answer is a Noul on compliance and decide flags when 1 - noul >= threshold. The interesting calibration band is the idempotent single-evaluator sweep (trap-eval-rerun-batch.ts), where a reviewer should land around noul 0.7 (P(violation) 0.3) — a threshold below ~0.35 would start flagging the shipped Phoenix example scripts. A threshold around 0.6–0.7 keeps the panel-review violation (P ~0.96) and drops both traps. options.minConfidence is unused because the check asks no Choice questions.

## Facts the engine does not extract yet

- Element shape of batch payloads: whether the objects pushed into `spanAnnotations`/`sessionAnnotations` arrays (usually built by `.map()` elsewhere in the file) set `identifier`, so the precheck could decide those calls without asking.
- Loop/repetition context for a call site: whether an annotation writer sits inside a `for`/`map` over reviewers, evaluators or retries, versus being executed once per target.
- Literal values of `name` and `identifier` (redacted to `<str:N>`), which would let the check see whether two writes in the same file use the same annotation name for the same target.
- Whether the local variable passed as the payload is assigned from a cross-file helper, which currently forces the question to rely on `code.text` reading alone.

## Fixtures

- `fixtures/bad-panel-review-annotations.ts` — violation
- `fixtures/good-panel-review-annotations.ts` — correct
- `fixtures/trap-open-coding-notes.ts` — trap
- `fixtures/trap-eval-rerun-batch.ts` — trap

## Next

```bash
pnpm build && jev-lint calibrate --plugin dist/index.js --key answer-key.json fixtures
```

<details><summary>Packet the model received</summary>

# Proposal context: references/annotations-typescript.md

Skill: `phoenix-tracing`. Plugin name: `phoenix`. Target import pattern: `^(@arizeai\/(phoenix-otel|phoenix-client|openinference-[\w-]+)|@opentelemetry\/[\w-]+)(\/.*)?$`.
Routing found this guidance relevant (≥ 0.7) to 6 of 29 surveyed in-scope file(s). No existing check cites it.

## What to produce

ONE check in the `@jev-oxlint/engine` `Check` shape (contract below, worked example after it):

- `appliesTo` and `precheck` are deterministic, using only the generic facts (`facts.calls` with `args[].entries`, `facts.memberCalls`, `facts.processHandlers`, `facts.exportedNames`, `facts.flags`, `facts.contextImports`). If the check genuinely needs a fact the engine does not extract, say so in `factsNeeded` and write the best check possible without it.
- Questions are narrow and atomic (one property each), Noul or Choice, and point into `state` by path: `code.calls[i]` (use `callIndex(facts, anchor)`), `code.calls[i].args[k].entries`, `facts.*`, and `guidance.<stateKey>`. Put facts in state and keep questions short; do not restate a candidate answer in the question.
- `decide` maps probabilities to a finding deterministically. Use `options.threshold` for Noul and `options.minConfidence` for Choice.
- `guidance` cites files by path from the list below; the file this proposal is for must be among them.
- String literals in linted code are redacted to `<str:N>` before jev sees them, so identifiers, member expressions and property keys carry the meaning. `kind`/`name`/`type` option values survive.
- Import only from `@jev-oxlint/engine` and node builtins. Strict TypeScript, ESM, `.js` import suffixes. Export the check as a named const.

Also produce fixtures: at least one violation, one correct version, and one trap a naive keyword rule would get wrong. Each fixture must import a target package so it is in scope, and must be realistic application code. And an answer key: the jev answers a careful human reviewer expects for every question the check asks about each fixture (question keys exactly as `questions()` generates them).

Questions and thresholds are what a reviewer reads first; make them precise.

## Guidance to enforce

# TypeScript SDK Annotation Patterns

Add feedback to spans, traces, documents, and sessions using the TypeScript client.

## Client Setup

```typescript
import { createClient } from "@arizeai/phoenix-client";
const client = createClient(); // Default: http://localhost:6006
```

## Span Annotations

Add feedback to individual spans:

```typescript
import { addSpanAnnotation } from "@arizeai/phoenix-client/spans";

await addSpanAnnotation({
  client,
  spanAnnotation: {
    spanId: "abc123",
    name: "quality",
    annotatorKind: "HUMAN",
    label: "high_quality",
    score: 0.95,
    explanation: "Accurate and well-formatted",
    metadata: { reviewer: "alice" },
  },
  sync: true,
});
```

## Span Notes

Notes are a special type of annotation for free-form text — useful for open coding, where reviewers leave qualitative observations on a span before any rubric exists. Later, those notes can be aggregated and distilled into structured labels or scores.

Notes are **append-only**: each call auto-generates a UUIDv4 identifier, so multiple notes naturally accumulate on the same span. Structured annotations are keyed by `(name, spanId, identifier)` — you can have many same-named annotations on one span by supplying distinct identifiers (e.g. one per reviewer); writing the same `(name, spanId, identifier)` overwrites the existing entry.

```typescript
import { addSpanNote } from "@arizeai/phoenix-client/spans";

await addSpanNote({
  client,
  spanNote: {
    spanId: "abc123",
    note: "This span shows unexpected behavior, needs review",
  },
});
```

## Document Annotations

Rate individual documents in RETRIEVER spans:

```typescript
import { addDocumentAnnotation } from "@arizeai/phoenix-client/spans";

await addDocumentAnnotation({
  client,
  documentAnnotation: {
    spanId: "retriever_span",
    documentPosition: 0, // 0-based index
    name: "relevance",
    annotatorKind: "LLM",
    label: "relevant",
    score: 0.95,
  },
});
```

## Trace Annotations

Feedback on entire traces:

```typescript
import { addTraceAnnotation } from "@arizeai/phoenix-client/traces";

await addTraceAnnotation({
  client,
  traceAnnotation: {
    traceId: "trace_abc",
    name: "correctness",
    annotatorKind: "HUMAN",
    label: "correct",
    score: 1.0,
  },
});
```

## Trace Notes

Notes on entire traces (multiple notes allowed per trace):

```typescript
import { addTraceNote } from "@arizeai/phoenix-client/traces";

await addTraceNote({
  client,
  traceNote: {
    traceId: "abc123def456",
    note: "Needs follow-up — unexpected tool call sequence",
  },
});
```

## Session Annotations

Feedback on multi-turn conversations:

```typescript
import { addSessionAnnotation } from "@arizeai/phoenix-client/sessions";

await addSessionAnnotation({
  client,
  sessionAnnotation: {
    sessionId: "session_xyz",
    name: "user_satisfaction",
    annotatorKind: "HUMAN",
    label: "satisfied",
    score: 0.85,
  },
});
```

## RAG Pipeline Example

```typescript
import { createClient } from "@arizeai/phoenix-client";
import { logDocumentAnnotations, addSpanAnnotation } from "@arizeai/phoenix-client/spans";
import { addTraceAnnotation } from "@arizeai/phoenix-client/traces";

const client = createClient();

// Document relevance (batch)
await logDocumentAnnotations({
  client,
  documentAnnotations: [
    {
      spanId: "retriever_span",
      documentPosition: 0,
      name: "relevance",
      annotatorKind: "LLM",
      label: "relevant",
      score: 0.95,
    },
    {
      spanId: "retriever_span",
      documentPosition: 1,
      name: "relevance",
      annotatorKind: "LLM",
      label: "relevant",
      score: 0.8,
    },
  ],
});

// LLM response quality
await addSpanAnnotation({
  client,
  spanAnnotation: {
    spanId: "llm_span",
    name: "faithfulness",
    annotatorKind: "LLM",
    label: "faithful",
    score: 0.9,
  },
});

// Overall trace quality
await addTraceAnnotation({
  client,
  traceAnnotation: {
    traceId: "trace_123",
    name: "correctness",
    annotatorKind: "HUMAN",
    label: "correct",
    score: 1.0,
  },
});
```

## API Reference

- [TypeScript Client API](https://arize-ai.github.io/phoenix/)

## Guidance files available for citation

- `references/annotations-typescript.md`
- `references/fundamentals-flattening.md`
- `references/fundamentals-overview.md`
- `references/fundamentals-required-attributes.md`
- `references/fundamentals-universal-attributes.md`
- `references/instrumentation-auto-typescript.md`
- `references/instrumentation-manual-typescript.md`
- `references/metadata-typescript.md`
- `references/production-typescript.md`
- `references/projects-typescript.md`
- `references/sessions-typescript.md`
- `references/setup-typescript.md`
- `references/span-agent.md`
- `references/span-chain.md`
- `references/span-embedding.md`
- `references/span-evaluator.md`
- `references/span-guardrail.md`
- `references/span-llm.md`
- `references/span-reranker.md`
- `references/span-retriever.md`
- `references/span-tool.md`

## Sample in-scope files (redacted exactly as jev sees them)

### ../phoenix/.claude/worktrees/oxlint-jev-plugin-42fd41/js/examples/apps/langchain-quickstart/src/pre_built_evals.ts (relevance 0.88)

```ts
import { openai } from "@ai-sdk/openai";
import { getSpans, logSpanAnnotations } from "@arizeai/phoenix-client/spans";
import { createCorrectnessEvaluator } from "@arizeai/phoenix-evals";

import "dotenv/config";

const toStr = (v: unknown) => (typeof v === "<str:6>" ? v : v != null ? JSON.stringify(v) : null);

interface SpanLike {
  attributes?: Record<string, unknown>;
  name?: string;
  span_name?: string;
  context?: { span_id?: string };
  span_id?: string;
  id?: string;
}

function getInputOutput(span: SpanLike) {
  const attrs = span.attributes ?? {};
  const input = toStr(attrs["input.value"] ?? attrs["input"]);
  const output = toStr(attrs["output.value"] ?? attrs["output"]);
  return { input, output };
}

async function main() {
  const base_model = openai("<str:11>");

  // **** Uncomment below for a custom endpoint LLM & Change Model in createCorrectnessEvaluator() **** //

  // const fireworks = createOpenAI({
  //   baseURL: "https://api.fireworks.ai/inference/v1",
  //   apiKey: process.env.FIREWORKS_API_KEY,
  // });
  // const custom_llm = fireworks.chat(
  //   "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507",
  // );

  const evaluator = createCorrectnessEvaluator({
    model: base_model,
  });

  const projectName = process.env.PHOENIX_PROJECT_NAME || "<str:22>";

  const { spans } = await getSpans({ project: { projectName }, limit: 500 });

  const parentSpans: { spanId: string; input: string; output: string }[] = [];
  for (const s of spans) {
    const span = s as SpanLike;
    const name = span.name ?? span.span_name;
    if (name !== "<str:9>") continue;
    const { input, output } = getInputOutput(span);
    const spanId = span.context?.span_id ?? span.span_id ?? span.id;
    if (input && output && spanId) {
      parentSpans.push({ spanId: String(spanId), input, output });
    }
  }

  const spanAnnotations = await Promise.all(
    parentSpans.map(async ({ spanId, input, output }) => {
      const r = await evaluator.evaluate({ input, output });
      return {
        spanId,
        name: "correctness" as const,
        label: r.label,
        score: r.score,
        explanation: r.explanation ?? undefined,
        annotatorKind: "LLM" as const,
        metadata: { evaluator: "<str:11>", input, output },
      };
    }),
  );

  await logSpanAnnotations({ spanAnnotations, sync: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

`code.calls` as the engine extracts them:

```json
[
  {
    "index": 0,
    "name": "getSpans",
    "source": "@arizeai/phoenix-client/spans",
    "line": 46,
    "call": "getSpans({ project: { projectName }, limit: 500 })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "project",
            "kind": "object",
            "entries": [
              {
                "key": "projectName",
                "kind": "expression",
                "value": "projectName"
              }
            ]
          },
          {
            "key": "limit",
            "kind": "literal",
            "value": 500
          }
        ]
      }
    ]
  },
  {
    "index": 1,
    "name": "logSpanAnnotations",
    "source": "@arizeai/phoenix-client/spans",
    "line": 75,
    "call": "logSpanAnnotations({ spanAnnotations, sync: true })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "spanAnnotations",
            "kind": "expression",
            "value": "spanAnnotations"
          },
          {
            "key": "sync",
            "kind": "literal",
            "value": true
          }
        ]
      }
    ]
  }
]
```

### ../phoenix/.claude/worktrees/oxlint-jev-plugin-42fd41/js/examples/apps/langchain-quickstart/src/custom_evals.ts (relevance 0.88)

```ts
import { openai } from "@ai-sdk/openai";
import { getSpans, logSpanAnnotations } from "@arizeai/phoenix-client/spans";
import { createClassificationEvaluator } from "@arizeai/phoenix-evals";

import "dotenv/config";

const EVAL_NAME = "<str:18>";
const AGENT_SPAN_NAME = "<str:9>";
const PROJECT_NAME = process.env.PHOENIX_PROJECT_NAME ?? "<str:22>";

const correctnessTemplate = `<str:1512>`;

function toString(v: unknown): string | null {
  if (typeof v === "<str:6>") return v;
  if (v != null) return JSON.stringify(v);
  return null;
}

interface SpanLike {
  name?: string;
  span_name?: string;
  attributes?: Record<string, unknown>;
  context?: { span_id?: string };
  span_id?: string;
  id?: string;
}

function getInputOutput(span: SpanLike): {
  input: string | null;
  output: string | null;
} {
  const attrs = span.attributes ?? {};
  const input = toString(attrs["input.value"] ?? attrs["input"]);
  const output = toString(attrs["output.value"] ?? attrs["output"]);
  return { input, output };
}

function getSpanId(span: SpanLike): string | null {
  const id = span.context?.span_id ?? span.span_id ?? span.id;
  return id != null ? String(id) : null;
}

async function main() {
  const base_model = openai("<str:11>");

  const evaluator = createClassificationEvaluator({
    model: base_model as Parameters<typeof createClassificationEvaluator>[0]["model"],
    promptTemplate: correctnessTemplate,
    choices: { correct: 1, incorrect: 0 },
    name: EVAL_NAME,
  });

  const { spans } = await getSpans({
    project: { projectName: PROJECT_NAME },
    limit: 500,
  });

  const toEvaluate: { spanId: string; input: string; output: string }[] = [];
  for (const s of spans as SpanLike[]) {
    if ((s.name ?? s.span_name) !== AGENT_SPAN_NAME) continue;
    const { input, output } = getInputOutput(s);
    const spanId = getSpanId(s);
    if (input && output && spanId) toEvaluate.push({ spanId, input, output });
  }

  const spanAnnotations = await Promise.all(
    toEvaluate.map(async ({ spanId, input, output }) => {
      const { label, score, explanation } = await evaluator.evaluate({
        input,
        output,
      });
      return {
        spanId,
        name: EVAL_NAME as "custom_correctness",
        label,
        score,
        explanation,
        annotatorKind: "LLM" as const,
        metadata: { evaluator: EVAL_NAME, input, output },
      };
    }),
  );

  await logSpanAnnotations({ spanAnnotations, sync: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

`code.calls` as the engine extracts them:

```json
[
  {
    "index": 0,
    "name": "getSpans",
    "source": "@arizeai/phoenix-client/spans",
    "line": 87,
    "call": "getSpans({\n    project: { projectName: PROJECT_NAME },\n    limit: 500,\n  })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "project",
            "kind": "object",
            "entries": [
              {
                "key": "projectName",
                "kind": "expression",
                "value": "PROJECT_NAME"
              }
            ]
          },
          {
            "key": "limit",
            "kind": "literal",
            "value": 500
          }
        ]
      }
    ]
  },
  {
    "index": 1,
    "name": "logSpanAnnotations",
    "source": "@arizeai/phoenix-client/spans",
    "line": 118,
    "call": "logSpanAnnotations({ spanAnnotations, sync: true })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "spanAnnotations",
            "kind": "expression",
            "value": "spanAnnotations"
          },
          {
            "key": "sync",
            "kind": "literal",
            "value": true
          }
        ]
      }
    ]
  }
]
```

### ../phoenix/.claude/worktrees/oxlint-jev-plugin-42fd41/js/examples/apps/mastra-quickstart/src/mastra/evals/evals.ts (relevance 0.88)

```ts
import { openai } from "@ai-sdk/openai";
import { getSpans, logSpanAnnotations } from "@arizeai/phoenix-client/spans";
import { createClassificationEvaluator } from "@arizeai/phoenix-evals";

import "dotenv/config";

const EVAL_NAME = "<str:12>";
const AGENT_SPAN_NAME = "<str:44>";
const PROJECT_NAME = process.env.PHOENIX_PROJECT_NAME ?? "<str:25>";

export const financialCompletenessTemplate = `<str:1215>`;

async function main() {
  const evaluator = createClassificationEvaluator({
    model: openai("<str:11>") as Parameters<typeof createClassificationEvaluator>[0]["model"],
    promptTemplate: financialCompletenessTemplate,
    choices: { complete: 1, incomplete: 0 },
    name: EVAL_NAME,
  });

  const { spans } = await getSpans({
    project: { projectName: PROJECT_NAME },
    limit: 500,
  });

  const toEvaluate: { spanId: string; input: string; output: string }[] = [];
  for (const s of spans) {
    const span = s as {
      name?: string;
      span_name?: string;
      attributes?: Record<string, unknown>;
      context?: { span_id?: string };
      span_id?: string;
      id?: string;
    };
    if ((span.name ?? span.span_name) !== AGENT_SPAN_NAME) continue;
    const attrs = span.attributes ?? {};
    const rawInput = attrs["input.value"] ?? attrs["input"];
    const rawOutput = attrs["output.value"] ?? attrs["output"];
    const input =
      typeof rawInput === "<str:6>" ? rawInput : rawInput != null ? JSON.stringify(rawInput) : null;
    const output =
      typeof rawOutput === "<str:6>"
        ? rawOutput
        : rawOutput != null
          ? JSON.stringify(rawOutput)
          : null;
    const rawId = span.context?.span_id ?? span.span_id ?? span.id;
    const spanId = rawId != null ? String(rawId) : null;
    if (input && output && spanId) toEvaluate.push({ spanId, input, output });
  }

  console.log(`<str:6>${toEvaluate.length}<str:31>`);

  const spanAnnotations = await Promise.all(
    toEvaluate.map(async ({ spanId, input, output }) => {
      const { label, score, explanation } = await evaluator.evaluate({
        input,
        output,
      });
      return {
        spanId,
        name: EVAL_NAME as "completeness",
        label,
        score,
        explanation,
        annotatorKind: "LLM" as const,
        metadata: { evaluator: EVAL_NAME, input, output },
      };
    }),
  );

  await logSpanAnnotations({ spanAnnotations, sync: true });
  console.log(`<str:7>${spanAnnotations.length}<str:1>${EVAL_NAME}<str:23>`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

`code.calls` as the engine extracts them:

```json
[
  {
    "index": 0,
    "name": "getSpans",
    "source": "@arizeai/phoenix-client/spans",
    "line": 49,
    "call": "getSpans({\n    project: { projectName: PROJECT_NAME },\n    limit: 500,\n  })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "project",
            "kind": "object",
            "entries": [
              {
                "key": "projectName",
                "kind": "expression",
                "value": "PROJECT_NAME"
              }
            ]
          },
          {
            "key": "limit",
            "kind": "literal",
            "value": 500
          }
        ]
      }
    ]
  },
  {
    "index": 1,
    "name": "logSpanAnnotations",
    "source": "@arizeai/phoenix-client/spans",
    "line": 105,
    "call": "logSpanAnnotations({ spanAnnotations, sync: true })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "spanAnnotations",
            "kind": "expression",
            "value": "spanAnnotations"
          },
          {
            "key": "sync",
            "kind": "literal",
            "value": true
          }
        ]
      }
    ]
  }
]
```

### ../phoenix/.claude/worktrees/oxlint-jev-plugin-42fd41/js/examples/apps/tracing-tutorial/evaluate-traces.ts (relevance 0.87)

```ts
/**
 * Phoenix Tracing Tutorial - LLM-as-Judge Evaluation
 *
 * This script evaluates spans to help debug why traces failed:
 * - Tool spans: Did lookupOrderStatus return an error?
 * - Retrieval spans: Was the retrieved context relevant?
 * - Session-level: Was the full conversation coherent? Was the issue resolved?
 *
 * After collecting user feedback (thumbs up/down), run this to automatically
 * annotate the child spans. Then click into unhelpful traces to see what went wrong.
 *
 * Run with: pnpm evaluate
 * Run session evals with: pnpm evaluate -- --sessions
 */

import { openai } from "@ai-sdk/openai";
import { SemanticConventions } from "@arizeai/openinference-semantic-conventions";
import { logSessionAnnotations } from "@arizeai/phoenix-client/sessions";
import { getSpans, logSpanAnnotations } from "@arizeai/phoenix-client/spans";
import { createClassificationEvaluator } from "@arizeai/phoenix-evals";

// =============================================================================
// Configuration
// =============================================================================

const PROJECT_NAME = "<str:11>";

// =============================================================================
// Create Evaluators
// =============================================================================

/**
 * Retrieval Relevance Evaluator - Determines if retrieved context was relevant
 * to the user's question.
 */
const retrievalRelevanceEvaluator = createClassificationEvaluator({
  name: "retrieval_relevance",
  model: openai("<str:11>"),
  choices: {
    relevant: 1,
    irrelevant: 0,
  },
  promptTemplate: `<str:383>`,
});

// =============================================================================
// Session-Level Evaluators
// =============================================================================

/**
 * Conversation Coherence Evaluator - Did the agent maintain context throughout
 * the conversation?
 */
const conversationCoherenceEvaluator = createClassificationEvaluator({
  name: "conversation_coherence",
  model: openai("<str:5>"),
  choices: {
    coherent: 1,
    incoherent: 0,
  },
  // Explanations are automatically generated by the evaluator
  promptTemplate: `<str:668>`,
});

/**
 * Resolution Evaluator - Was the customer's issue resolved by the end of the
 * conversation?
 */
const resolutionEvaluator = createClassificationEvaluator({
  name: "resolution_status",
  model: openai("<str:5>"),
  choices: {
    resolved: 1,
    unresolved: 0,
  },
  // Explanations are automatically generated by the evaluator
  promptTemplate: `<str:518>`,
});

// =============================================================================
// Main Evaluation Function
// =============================================================================

interface SpanData {
  context: {
    span_id: string;
    trace_id: string;
  };
  name: string;
  attributes: Record<string, unknown>;
}

async function fetchEvaluationSpans({
  limit,
  command,
}: {
  limit: number;
  command: "start" | "sessions";
}): Promise<SpanData[] | undefined> {
  try {
    const result = await getSpans({
      project: { projectName: PROJECT_NAME },
      limit,
    });
    const spans = result.spans as unknown as SpanData[];
    console.log(`<str:9>${spans.length}<str:6>`);
    return spans;
  } catch (error) {
    console.error("<str:24>", error);
    console.log("<str:14>");
    console.log("<str:49>");
    console.log(`<str:23>${command}<str:26>`);
    return undefined;
  }
}

function getTraceEvaluationSpans(spans: SpanData[]) {
  return {
    toolSpans: spans.filter((span) => span.name === "<str:11>"),
    llmSpans: spans.filter(
      (span) =>
        span.name === "<str:15>" &&
        String(span.attributes["input.value"] || "<str:0>").includes("<str:109>"),
    ),
  };
}

function hasTraceEvaluationSpans({
  toolSpans,
  llmSpans,
}: {
  toolSpans: SpanData[];
  llmSpans: SpanData[];
}): boolean {
  return toolSpans.length > 0 || llmSpans.length > 0;
}

function groupSpansBySession(spans: SpanData[]): Map<string, SpanData[]> {
  const groups = new Map<string, SpanData[]>();
  for (const span of spans) {
    if (span.name !== "<str:13>") continue;
    const sessionId = span.attributes[SemanticConventions.SESSION_ID] as string;
    if (!sessionId) continue;
    const sessionSpans = groups.get(sessionId) ?? [];
    sessionSpans.push(span);
    groups.set(sessionId, sessionSpans);
  }
  return groups;
}

async function evaluateTraces() {
  console.log("<str:1>".repeat(60));
  console.log("<str:48>");
  console.log("<str:1>".repeat(60));

  // Step 1: Fetch spans from Phoenix
  console.log("<str:34>");
  console.log(`<str:12>${PROJECT_NAME}`);

  const spans = await fetchEvaluationSpans({ limit: 100, command: "<str:5>" });
  if (!spans) return;

  // Step 2: Filter spans by type
  const { toolSpans, llmSpans } = getTraceEvaluationSpans(spans);

  console.log(`<str:9>${toolSpans.length}<str:11>`);
  console.log(`<str:9>${llmSpans.length}<str:21>`);

  if (!hasTraceEvaluationSpans({ toolSpans, llmSpans })) {
    console.log("<str:75>");
    return;
  }

  const annotations: Array<{
    spanId: string;
    name: string;
    label: string;
    score: number;
    explanation?: string;
    annotatorKind: "LLM";
    metadata: Record<string, unknown>;
  }> = [];

  // Step 3: Evaluate tool spans (simple code-based check)
  console.log("<str:28>");
  console.log("<str:1>".repeat(60));

  for (const span of toolSpans) {
    const spanId = span.context.span_id;
    const output = JSON.stringify(span.attributes["output.value"] || "<str:0>");

    // Simple check: does the output contain "error" or "not found"?
    const hasError =
      output.toLowerCase().includes("<str:5>") || output.toLowerCase().includes("<str:9>");

    const status = hasError ? "<str:7>" : "<str:9>";
    console.log(`<str:13>${spanId.substring(0, 8)}<str:4>${status}`);

    annotations.push({
      spanId,
      name: "tool_result",
      label: hasError ? "<str:5>" : "<str:7>",
      score: hasError ? 0 : 1,
      explanation: hasError ? "<str:46>" : "<str:26>",
      annotatorKind: "LLM" as const, // Using "LLM" for consistency, though this is code-based
      metadata: {
        evaluator: "<str:11>",
        type: "code",
      },
    });
  }

  // Step 3c: Evaluate retrieval relevance (requires finding the query context)
  // This is more complex - we need to extract the context from the LLM span's system prompt
  // For simplicity, we'll check if the RAG spans have relevant context by looking at the generation
  console.log("<str:37>");
  console.log("<str:1>".repeat(60));

  for (const span of llmSpans) {
    const spanId = span.context.span_id;

    // Extract the system prompt (which contains the retrieved context)
    const input = (span.attributes["input.value"] as string) || "<str:0>";

    try {
      const result = await retrievalRelevanceEvaluator.evaluate({
        input: input,
      });
      const label = result.label ?? "<str:7>";
      const score = result.score ?? 0;
      const status = label === "<str:8>" ? "<str:10>" : "<str:12>";
      console.log(`<str:12>${spanId.substring(0, 8)}<str:4>${status}`);

      annotations.push({
        spanId,
        name: "retrieval_relevance",
        label,
        score,
        explanation: result.explanation,
        annotatorKind: "<str:3>",
        metadata: {
          model: "<str:11>",
          evaluator: "<str:19>",
        },
      });
    } catch (_error) {
      console.error(`<str:27>${spanId.substring(0, 8)}<str:3>`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Step 4: Log annotations to Phoenix
  console.log("<str:1>" + "<str:1>".repeat(60));
  console.log("<str:43>");

  if (annotations.length > 0) {
    try {
      await logSpanAnnotations({
        spanAnnotations: annotations,
        sync: false, // async mode - Phoenix processes in background
      });
      console.log(`<str:9>${annotations.length}<str:23>`);
    } catch (error) {
      console.error("<str:28>", error);
    }
  }

  // Step 5: Summary
  console.log("<str:1>" + "<str:1>".repeat(60));
  console.log("<str:21>");
  console.log("<str:1>".repeat(60));

  // Tool span summary
  const toolAnnotations = annotations.filter((a) => a.name === "<str:11>");
  if (toolAnnotations.length > 0) {
    const successCount = toolAnnotations.filter((a) => a.label === "<str:7>").length;
    const errorCount = toolAnnotations.filter((a) => a.label === "<str:5>").length;

    console.log(`<str:39>`);
    console.log(`<str:15>${successCount}<str:11>${errorCount}`);
  }

  // Retrieval span summary
  const retrievalAnnotations = annotations.filter((a) => a.name === "<str:19>");
  if (retrievalAnnotations.length > 0) {
    const relevantCount = retrievalAnnotations.filter((a) => a.label === "<str:8>").length;
    const irrelevantCount = retrievalAnnotations.filter((a) => a.label === "<str:10>").length;

    console.log(`<str:22>`);
    console.log(`<str:16>${relevantCount}<str:15>${irrelevantCount}`);
  }

  console.log("<str:1>" + "<str:1>".repeat(60));
  console.log("<str:43>");
  console.log("<str:0>");
  console.log("<str:53>");
  console.log("<str:46>");
  console.log("<str:69>");
  console.log("<str:1>".repeat(60));
}

// =============================================================================
// Session-Level Evaluation Function
// =============================================================================

async function evaluateSessions() {
  console.log("<str:1>".repeat(60));
  console.log("<str:51>");
  console.log("<str:1>".repeat(60));

  // Step 1: Fetch spans from Phoenix
  console.log("<str:34>");
  console.log(`<str:12>${PROJECT_NAME}`);

  const spans = await fetchEvaluationSpans({
    limit: 200,
    command: "<str:8>",
  });
  if (!spans) return;

  const sessionGroups = groupSpansBySession(spans);

  console.log(`<str:9>${sessionGroups.size}<str:26>`);

  if (sessionGroups.size === 0) {
    console.log("<str:77>");
    return;
  }

  // Session-level annotations (attached to sessions, not spans!)
  const sessionAnnotations: Array<{
    sessionId: string;
    name: string;
    label: string;
    score: number;
    explanation?: string;
    annotatorKind: "LLM";
    metadata: Record<string, unknown>;
  }> = [];

  // Step 3: Evaluate each session
  console.log("<str:28>");
  console.log("<str:1>".repeat(60));

  for (const [sessionId, sessionSpans] of sessionGroups) {
    console.log(`<str:14>${sessionId.substring(0, 8)}<str:3>`);
    console.log(`<str:10>${sessionSpans.length}`);

    // Sort by turn number if available, otherwise by span order
    sessionSpans.sort((a, b) => {
      const turnA = (a.attributes["conversation.turn"] as number) || 0;
      const turnB = (b.attributes["conversation.turn"] as number) || 0;
      return turnA - turnB;
    });

    // Build conversation transcript
    const transcript = sessionSpans
      .map((span, i) => {
        const input = (span.attributes["input.value"] as string) || "<str:0>";
        const output = (span.attributes["output.value"] as string) || "<str:0>";
        return `<str:5>${i + 1}<str:9>${input}<str:9>${output}`;
      })
      .join("<str:2>");

    console.log("<str:22>", transcript.substring(0, 100) + "<str:3>");

    // Evaluate coherence
    try {
      const coherenceResult = await conversationCoherenceEvaluator.evaluate({
        input: transcript,
      });
      const coherenceLabel = coherenceResult.label ?? "<str:7>";
      const coherenceScore = coherenceResult.score ?? 0;
      const status = coherenceLabel === "<str:8>" ? "<str:10>" : "<str:12>";
      console.log(`<str:14>${status}`);
      if (coherenceResult.explanation) {
        console.log(`<str:16>${coherenceResult.explanation}`);
      }

      sessionAnnotations.push({
        sessionId, // Annotate at the session level!
        name: "conversation_coherence",
        label: coherenceLabel,
        score: coherenceScore,
        explanation: coherenceResult.explanation,
        annotatorKind: "<str:3>",
        metadata: {
          model: "<str:5>",
          evaluator: "<str:22>",
          turnCount: sessionSpans.length,
        },
      });
    } catch (_error) {
      console.error(`<str:32>`);
    }

    // Evaluate resolution
    try {
      const resolutionResult = await resolutionEvaluator.evaluate({
        input: transcript,
      });
      const resolutionLabel = resolutionResult.label ?? "<str:7>";
      const resolutionScore = resolutionResult.score ?? 0;
      const status = resolutionLabel === "<str:8>" ? "<str:10>" : "<str:12>";
      console.log(`<str:15>${status}`);
      if (resolutionResult.explanation) {
        console.log(`<str:16>${resolutionResult.explanation}`);
      }

      sessionAnnotations.push({
        sessionId, // Annotate at the session level!
        name: "resolution_status",
        label: resolutionLabel,
        score: resolutionScore,
        explanation: resolutionResult.explanation,
        annotatorKind: "<str:3>",
        metadata: {
          model: "<str:5>",
          evaluator: "<str:17>",
          turnCount: sessionSpans.length,
        },
      });
    } catch (_error) {
      console.error(`<str:33>`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Step 4: Log session annotations to Phoenix
  console.log("<str:1>" + "<str:1>".repeat(60));
  console.log("<str:51>");

  if (sessionAnnotations.length > 0) {
    try {
      await logSessionAnnotations({
        sessionAnnotations,
        sync: false,
      });
      console.log(`<str:9>${sessionAnnotations.length}<str:26>`);
    } catch (error) {
      console.error("<str:36>", error);
    }
  }

  // Step 5: Summary
  console.log("<str:1>" + "<str:1>".repeat(60));
  console.log("<str:29>");
  console.log("<str:1>".repeat(60));

  const coherenceAnnotations = sessionAnnotations.filter((a) => a.name === "<str:22>");
  const resolutionAnnotations = sessionAnnotations.filter((a) => a.name === "<str:17>");

  if (coherenceAnnotations.length > 0) {
    const coherentCount = coherenceAnnotations.filter((a) => a.label === "<str:8>").length;
    console.log(`<str:31>`);
    console.log(`<str:16>${coherentCount}<str:1>${coherenceAnnotations.length}`);
  }

  if (resolutionAnnotations.length > 0) {
    const resolvedCount = resolutionAnnotations.filter((a) => a.label === "<str:8>").length;
    console.log(`<str:24>`);
    console.log(`<str:16>${resolvedCount}<str:1>${resolutionAnnotations.length}`);
  }

  console.log("<str:1>" + "<str:1>".repeat(60));
  console.log("<str:43>");
  console.log("<str:0>");
  console.log("<str:17>");
  console.log("<str:53>");
  console.log("<str:55>");
  console.log("<str:61>");
  console.log("<str:64>");
  console.log("<str:59>");
  console.log("<str:1>".repeat(60));
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
  const runSessions = process.argv.includes("<str:10>");

  if (runSessions) {
    await evaluateSessions();
  } else {
    await evaluateTraces();
  }
}

// Run the evaluation
main().catch(console.error);
```

`code.calls` as the engine extracts them:

```json
[
  {
    "index": 0,
    "name": "getSpans",
    "source": "@arizeai/phoenix-client/spans",
    "line": 145,
    "call": "getSpans({\n      project: { projectName: PROJECT_NAME },\n      limit,\n    })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "project",
            "kind": "object",
            "entries": [
              {
                "key": "projectName",
                "kind": "expression",
                "value": "PROJECT_NAME"
              }
            ]
          },
          {
            "key": "limit",
            "kind": "expression",
            "value": "limit"
          }
        ]
      }
    ]
  },
  {
    "index": 1,
    "name": "logSpanAnnotations",
    "source": "@arizeai/phoenix-client/spans",
    "line": 310,
    "call": "logSpanAnnotations({\n        spanAnnotations: annotations,\n        sync: false, // async mode - Phoenix processes in background\n      })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "spanAnnotations",
            "kind": "expression",
            "value": "annotations"
          },
          {
            "key": "sync",
            "kind": "literal",
            "value": false
          }
        ]
      }
    ]
  },
  {
    "index": 2,
    "name": "logSessionAnnotations",
    "source": "@arizeai/phoenix-client/sessions",
    "line": 506,
    "call": "logSessionAnnotations({\n        sessionAnnotations,\n        sync: false,\n      })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "sessionAnnotations",
            "kind": "expression",
            "value": "sessionAnnotations"
          },
          {
            "key": "sync",
            "kind": "literal",
            "value": false
          }
        ]
      }
    ]
  }
]
```

### ../phoenix/.claude/worktrees/oxlint-jev-plugin-42fd41/js/examples/apps/mastra-agent/src/eval/evals.ts (relevance 0.85)

```ts
// This document is for a correctness eval on tools and goal completion for the agent.

import assert from "assert";
import { openai } from "@ai-sdk/openai";
import { getSpans, logSpanAnnotations } from "@arizeai/phoenix-client/spans";
import { createClassificationEvaluator } from "@arizeai/phoenix-evals";

import "dotenv/config";

const model = openai("<str:11>");

const toolCorrectnessPrompt = `<str:1180>`;

const agentGoalCompletionPrompt = `<str:1178>`;

interface SpanLike {
  attributes?: Record<string, unknown>;
  events?: Array<{ attributes?: Record<string, unknown> }>;
  name?: string;
  kind?: string;
  global_id?: string;
  context?: Record<string, unknown>;
  span_id?: string;
  id?: string;
  spanId?: string;
  parent_span_id?: string;
  parentSpanId?: string;
  trace_id?: string;
  traceId?: string;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "<str:6>") return value;
  if (value != null) return JSON.stringify(value);
  return null;
}

function extractInputOutputFromSpan(span: SpanLike): {
  input: string | null;
  output: string | null;
} {
  let input: string | null = null;
  let output: string | null = null;

  if (span.attributes) {
    input = toStringValue(span.attributes["input.value"] ?? span.attributes["input"]);
    output = toStringValue(span.attributes["output.value"] ?? span.attributes["output"]);
  }

  if ((!input || !output) && span.events) {
    for (const event of span.events) {
      if (event.attributes) {
        if (!input) {
          input = toStringValue(event.attributes["input"]);
        }
        if (!output) {
          output = toStringValue(event.attributes["output"]);
        }
      }
    }
  }

  return { input, output };
}

type EvaluationCase = { input: string; output: string; spanId: string };
type EvaluationResult = EvaluationCase & {
  label: string | null;
  score: number | null;
  explanation: string | null;
};

function getSpanId(span: SpanLike): string | number | undefined {
  return (
    span.global_id ||
    (span.context?.span_id as string | undefined) ||
    span.span_id ||
    span.id ||
    (span.context?.spanId as string | undefined) ||
    span.spanId
  );
}

function getTraceId(span: SpanLike): string | undefined {
  return (
    (span.context?.trace_id as string | undefined) ||
    span.trace_id ||
    (span.context?.traceId as string | undefined) ||
    span.traceId
  );
}

function getParentSpanId(span: SpanLike): string | undefined {
  return (
    span.parent_span_id ||
    (span.context?.parent_span_id as string | undefined) ||
    span.parentSpanId ||
    (span.context?.parentSpanId as string | undefined)
  );
}

async function fetchRecentSpans(projectName: string): Promise<SpanLike[]> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
  const spans: SpanLike[] = [];
  let cursor: string | null | undefined;
  do {
    const result = await getSpans({
      project: { projectName },
      startTime,
      endTime,
      cursor,
      limit: 100,
    });
    spans.push(...result.spans);
    cursor = result.nextCursor || undefined;
  } while (cursor);
  return spans;
}

function toEvaluationCases(spans: SpanLike[]): EvaluationCase[] {
  return spans.flatMap((span) => {
    const { input, output } = extractInputOutputFromSpan(span);
    const spanId = getSpanId(span);
    if (!input || !output || spanId == null) return [];
    const normalizedSpanId =
      typeof spanId === "<str:6>" ? spanId.toString(16) : String(spanId).replace(/^0x/, "<str:0>");
    return [{ input, output, spanId: normalizedSpanId }];
  });
}

function getToolSpans(spans: SpanLike[]): SpanLike[] {
  const toolNames = ["<str:13>", "<str:8>", "<str:17>"];
  return spans.filter((span) => {
    const name = span.name?.toLowerCase() || "<str:0>";
    const kind = span.kind?.toLowerCase() || "<str:0>";
    return (
      toolNames.some((toolName) => name.includes(toolName)) ||
      kind === "<str:4>" ||
      kind === "<str:8>"
    );
  });
}

function getAgentRootSpans({
  spans,
  toolSpans,
}: {
  spans: SpanLike[];
  toolSpans: SpanLike[];
}): SpanLike[] {
  const toolSpanIds = new Set(toolSpans.map(getSpanId));
  const spansByTrace = new Map<string, SpanLike[]>();
  for (const span of spans) {
    const traceId = getTraceId(span);
    if (!traceId) continue;
    spansByTrace.set(traceId, [...(spansByTrace.get(traceId) ?? []), span]);
  }
  return Array.from(spansByTrace.values())
    .flatMap((traceSpans) =>
      traceSpans.filter((span) => {
        const parentId = getParentSpanId(span);
        return !parentId || !traceSpans.some((candidate) => getSpanId(candidate) === parentId);
      }),
    )
    .filter((span) => {
      const name = span.name?.toLowerCase() || "<str:0>";
      const kind = span.kind?.toLowerCase() || "<str:0>";
      const isAgent =
        span.attributes?.["gen_ai.system"] === "<str:5>" ||
        kind === "<str:5>" ||
        kind === "<str:3>";
      return (
        (name.includes("<str:5>") || name.includes("<str:5>") || isAgent) &&
        !toolSpanIds.has(getSpanId(span))
      );
    });
}

async function evaluateCases({
  cases,
  name,
  choices,
  promptTemplate,
}: {
  cases: EvaluationCase[];
  name: string;
  choices: Record<string, number>;
  promptTemplate: string;
}): Promise<EvaluationResult[]> {
  const evaluator = await createClassificationEvaluator({
    name,
    model,
    choices,
    promptTemplate,
  });
  const results: EvaluationResult[] = [];
  for (const testCase of cases) {
    const result = await evaluator.evaluate(testCase);
    results.push({ ...testCase, ...result });
  }
  return results;
}

async function logEvaluationResults({
  results,
  name,
}: {
  results: EvaluationResult[];
  name: string;
}): Promise<void> {
  const spanAnnotations = results.map((result) => ({
    spanId: result.spanId,
    name,
    label: result.label,
    score: result.score,
    explanation: result.explanation || undefined,
    annotatorKind: "LLM" as const,
    metadata: {
      evaluator: name,
      input: result.input.substring(0, 500),
      output: result.output.substring(0, 500),
    },
  }));
  try {
    await logSpanAnnotations({ spanAnnotations, sync: true });
  } catch (_error) {}
}

async function main() {
  if (!process.env.PHOENIX_ENDPOINT && !process.env.PHOENIX_COLLECTOR_ENDPOINT) {
    throw new Error("<str:81>");
  }
  const spans = await fetchRecentSpans(process.env.PHOENIX_PROJECT_NAME || "<str:14>");
  const toolSpans = getToolSpans(spans);
  const toolCases = toEvaluationCases(toolSpans);
  if (toolCases.length === 0) return;

  const correctnessResults = await evaluateCases({
    cases: toolCases,
    name: "correctness",
    choices: { correct: 1, incorrect: 0 },
    promptTemplate: toolCorrectnessPrompt,
  });
  const correctCount = correctnessResults.filter((result) => result.label === "<str:7>").length;
  assert(
    correctCount >= correctnessResults.length * 0.5,
    `<str:49>${correctCount}<str:1>${correctnessResults.length}<str:7>`,
  );
  await logEvaluationResults({
    results: correctnessResults,
    name: "correctness",
  });

  const agentCases = toEvaluationCases(getAgentRootSpans({ spans, toolSpans }));
  if (agentCases.length === 0) return;
  const goalResults = await evaluateCases({
    cases: agentCases,
    name: "goal_completion",
    choices: { completed: 1, incomplete: 0 },
    promptTemplate: agentGoalCompletionPrompt,
  });
  await logEvaluationResults({ results: goalResults, name: "goal_completion" });
}

main().catch(() => {
  process.exit(1);
});
```

`code.calls` as the engine extracts them:

```json
[
  {
    "index": 0,
    "name": "getSpans",
    "source": "@arizeai/phoenix-client/spans",
    "line": 168,
    "call": "getSpans({\n      project: { projectName },\n      startTime,\n      endTime,\n      cursor,\n      limit: 100,\n    })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "project",
            "kind": "object",
            "entries": [
              {
                "key": "projectName",
                "kind": "expression",
                "value": "projectName"
              }
            ]
          },
          {
            "key": "startTime",
            "kind": "expression",
            "value": "startTime"
          },
          {
            "key": "endTime",
            "kind": "expression",
            "value": "endTime"
          },
          {
            "key": "cursor",
            "kind": "expression",
            "value": "cursor"
          },
          {
            "key": "limit",
            "kind": "literal",
            "value": 100
          }
        ]
      }
    ]
  },
  {
    "index": 1,
    "name": "logSpanAnnotations",
    "source": "@arizeai/phoenix-client/spans",
    "line": 291,
    "call": "logSpanAnnotations({ spanAnnotations, sync: true })",
    "args": [
      {
        "index": 0,
        "kind": "object",
        "entries": [
          {
            "key": "spanAnnotations",
            "kind": "expression",
            "value": "spanAnnotations"
          },
          {
            "key": "sync",
            "kind": "literal",
            "value": true
          }
        ]
      }
    ]
  }
]
```

## Check contract (`@jev-oxlint/engine`)

```ts
/**
 * The check contract. A check is the unit a linter author writes (or a
 * proposer drafts): a deterministic trigger, whatever code can decide
 * outright, narrow jev questions that point into `state`, and a
 * deterministic mapping from probabilities to findings.
 */
import type { RuleDefaults } from "./config.js";
import type { ArgFact, CallFact, Facts, ObjectEntry } from "./facts.js";
import type { GuidanceRef, GuidanceStore } from "./guidance.js";
import type { Answer, Question } from "./jev/types.js";

export type CheckOptions = Pick<RuleDefaults, "threshold" | "minConfidence">;

export interface Finding {
  message: string;
  anchor?: CallFact;
  /** Probability or confidence backing the finding, shown in the message. */
  score: number;
}

export type Precheck =
  "ask" | "skip" | { violation: Finding } | { violations: Finding[]; then: "ask" | "skip" };

/** What a check may read while building questions. */
export interface CheckContext {
  guidance: GuidanceStore;
}

export interface QuestionSpec {
  key: string;
  question: Question;
  anchor?: CallFact;
  /** Free-form handle for `decide` (e.g. the attribute a question is about). */
  subject?: unknown;
}

export interface Check {
  id: string;
  /** Key under `state.guidance` and in question text. */
  stateKey: string;
  title: string;
  /** Whole files sent in `state.guidance[stateKey]`. */
  guidance: GuidanceRef[];
  /** Guidance accounted for without being sent (e.g. used as Choice criteria). Suppresses hints. */
  covers?: GuidanceRef[];
  appliesTo(facts: Facts): CallFact[];
  precheck?(facts: Facts, anchors: CallFact[]): Precheck;
  questions(facts: Facts, anchors: CallFact[], ctx: CheckContext): QuestionSpec[];
  decide(
    answer: Answer,
    spec: QuestionSpec,
    options: CheckOptions,
    facts: Facts,
  ): Finding | undefined;
}

export const defineCheck = (check: Check): Check => check;

// ---- helpers for writing checks ------------------------------------------

/** Position in `state.code.calls`; questions point at `code.calls[i]`. */
export const callIndex = (facts: Facts, anchor: CallFact): number => facts.calls.indexOf(anchor);

export const objectArg = (call: CallFact, index: number): ArgFact | undefined => {
  const arg = call.args[index];
  return arg?.kind === "object" ? arg : undefined;
};

export const entry = (entries: ObjectEntry[] | undefined, key: string): ObjectEntry | undefined =>
  entries?.find((e) => e.key === key);

export const literalBoolean = (e: ObjectEntry | undefined): boolean | undefined =>
  e?.valueKind === "literal" && typeof e.literalValue === "boolean" ? e.literalValue : undefined;

export const isExported = (facts: Facts, call: CallFact): boolean =>
  call.assignedTo !== undefined && facts.exportedNames.includes(call.assignedTo);

export const callsFrom = (
  facts: Facts,
  source: string | RegExp,
  names?: readonly string[],
): CallFact[] =>
  facts.calls.filter(
    (c) =>
      (typeof source === "string" ? c.source === source : source.test(c.source)) &&
      (names === undefined || names.includes(c.name)),
  );

/** Noul helper: P(violation) when the question is phrased as "does the code comply?". */
export const pViolation = (answer: Answer): number | undefined =>
  answer.type === "noul" ? 1 - answer.noul : undefined;
```

## Worked example check

```ts
import {
  callIndex,
  callsFrom,
  defineCheck,
  entry,
  isExported,
  literalBoolean,
  objectArg,
} from "@jev-oxlint/engine";

const PHOENIX_OTEL = "@arizeai/phoenix-otel";
const FLUSH_METHODS = new Set(["shutdown", "forceFlush"]);

export const flushBeforeExit = defineCheck({
  id: "flush-before-exit",
  stateKey: "flush_before_exit",
  title: "Flush spans before the process exits",
  guidance: [
    { skill: "phoenix-tracing", file: "references/setup-typescript.md" },
    { skill: "phoenix-tracing", file: "references/production-typescript.md" },
  ],
  appliesTo: (facts) => callsFrom(facts, PHOENIX_OTEL, ["register"]),
  precheck(facts, anchors) {
    const options = (a: (typeof anchors)[number]) => objectArg(a, 0)?.entries;
    // `batch: false` exports each span as it ends; guidance says no shutdown needed.
    if (anchors.every((a) => literalBoolean(entry(options(a), "batch")) === false)) return "skip";
    if (facts.memberCalls.some((m) => FLUSH_METHODS.has(m.method))) return "ask";
    // Handed to another module; flushing is its job (cross-file is out of scope).
    if (anchors.some((a) => isExported(facts, a))) return "skip";
    return {
      violation: {
        anchor: anchors[0],
        score: 1,
        message:
          "register() is called but the returned provider is never flushed and not exported for a caller to flush.",
      },
    };
  },
  questions: (facts, anchors) => [
    {
      key: "flush_before_exit",
      anchor: anchors[0],
      question: {
        type: "noul",
        instructions: {
          question:
            "Judging only `code.text`, are spans queued by the provider returned from register() flushed on every path by which this process can end: normal completion, a thrown error, and termination signals?",
          guidance: "`guidance.flush_before_exit`",
          inspect: [
            `\`code.calls[${callIndex(facts, anchors[0]!)}].args[0]\` — the register() options`,
            "`facts.memberCalls` — every shutdown()/forceFlush() call and its line",
            "`facts.processHandlers` — which process events are handled",
          ],
        },
        criteria: {
          true: "Every realistic exit path reaches a flush or shutdown of the provider.",
          false:
            "At least one realistic exit path skips the flush, e.g. errors are caught and the process exits without flushing.",
        },
      },
    },
  ],
  decide(answer, spec, options) {
    if (answer.type !== "noul") return undefined;
    const p = 1 - answer.noul;
    if (p < options.threshold) return undefined;
    return {
      anchor: spec.anchor,
      score: p,
      message: "Spans may be dropped on exit: the provider is not flushed on every exit path.",
    };
  },
});
```

</details>
