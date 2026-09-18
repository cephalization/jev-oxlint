/** Shared helpers for the span-wrapper checks. */
import type { CallFact, Facts, ObjectEntry } from "@jev-oxlint/engine";
import { entry, objectArg } from "@jev-oxlint/engine";

import { OPENINFERENCE_CORE, PHOENIX_OTEL } from "./linter.js";

export const SPAN_WRAPPER_KINDS: Record<string, string> = {
  traceChain: "CHAIN",
  traceAgent: "AGENT",
  traceTool: "TOOL",
  traceLLM: "LLM",
  traceRetriever: "RETRIEVER",
  traceReranker: "RERANKER",
  traceEmbedding: "EMBEDDING",
  traceGuardrail: "GUARDRAIL",
  traceEvaluator: "EVALUATOR",
  tracePrompt: "PROMPT",
};

export const isSpanWrapperCall = (c: CallFact): boolean =>
  (c.name === "withSpan" || c.name in SPAN_WRAPPER_KINDS) &&
  (c.source === OPENINFERENCE_CORE || c.source === PHOENIX_OTEL);

export const spanWrapperCalls = (facts: Facts): CallFact[] => facts.calls.filter(isSpanWrapperCall);

/** `kind:` option literal is a string, which is redacted — so read it from the raw source text of the entry. */
export function declaredKind(c: CallFact): string | undefined {
  const fromName = SPAN_WRAPPER_KINDS[c.name];
  if (fromName) return fromName;
  const kind = entry(objectArg(c, 1)?.entries, "kind");
  // `kind`/`name`/`type` values are structural and survive redaction verbatim.
  const m = kind && kind.valueKind === "literal" ? /^["'`](\w+)["'`]$/.exec(kind.valueText) : null;
  return m?.[1];
}

export const spanOptions = (c: CallFact): ObjectEntry[] | undefined => objectArg(c, 1)?.entries;

export const spanAttributes = (c: CallFact): ObjectEntry[] =>
  entry(spanOptions(c), "attributes")?.entries ?? [];

export const dynamicAttributes = (c: CallFact): ObjectEntry[] =>
  spanAttributes(c).filter((a) => a.valueKind !== "literal");

export const processInput = (c: CallFact): string | undefined =>
  entry(spanOptions(c), "processInput")?.valueText;
export const processOutput = (c: CallFact): string | undefined =>
  entry(spanOptions(c), "processOutput")?.valueText;
