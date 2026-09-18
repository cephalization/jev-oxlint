import type { EntryType } from "@jev-oxlint/engine";
import { callIndex, defineCheck } from "@jev-oxlint/engine";

import { declaredKind, spanWrapperCalls } from "../spanHelpers.js";

const SPAN_KIND_FILES: Record<string, string> = {
  LLM: "span-llm.md",
  CHAIN: "span-chain.md",
  RETRIEVER: "span-retriever.md",
  TOOL: "span-tool.md",
  AGENT: "span-agent.md",
  EMBEDDING: "span-embedding.md",
  RERANKER: "span-reranker.md",
  GUARDRAIL: "span-guardrail.md",
  EVALUATOR: "span-evaluator.md",
};
const spanFile = (file: string) => ({ skill: "phoenix-tracing", file: `references/${file}` });

export const spanKindMatchesBody = defineCheck({
  id: "span-kind-matches-body",
  stateKey: "span_kind",
  title: "Declared OpenInference span kind matches what the wrapped function does",
  guidance: [
    { skill: "phoenix-tracing", file: "references/instrumentation-manual-typescript.md" },
    { skill: "phoenix-tracing", file: "references/span-chain.md" },
    { skill: "phoenix-tracing", file: "references/sessions-typescript.md" },
  ],
  // Used as Choice criteria below; counted as covered so the hint tier stays quiet about them.
  covers: Object.values(SPAN_KIND_FILES).map(spanFile),
  appliesTo: (facts) => spanWrapperCalls(facts).filter((c) => declaredKind(c) !== undefined),
  questions: (facts, anchors, ctx) => {
    const criteria: Record<string, EntryType> = {};
    for (const [kind, file] of Object.entries(SPAN_KIND_FILES))
      criteria[kind] = ctx.guidance.load(spanFile(file)).text;
    criteria.PROMPT =
      "Prompt construction, rendering, or templating — building the text sent to a model, not calling it.";
    return anchors.map((anchor, i) => ({
      key: `span_kind_${i}`,
      anchor,
      subject: declaredKind(anchor),
      question: {
        type: "choice",
        instructions: {
          question: `Which OpenInference span kind best describes what the function wrapped at \`code.calls[${callIndex(facts, anchor)}].call\` actually does?`,
          focus:
            "Judge by the wrapped function's behaviour — what it calls and returns — not by the kind the developer declared.",
          reference:
            "`guidance.span_kind` lists the wrappers and their intended use, the CHAIN span spec, and how a root interaction span relates to the agent/LLM spans nested under it.",
          note: "A wrapper whose body only delegates to an LLM or agent client (model.generate, agent.generate, llm.summarize) is the CHAIN or AGENT boundary around that call; the LLM span itself comes from auto-instrumentation of the client. Answer LLM only when the wrapped code performs the model request directly (builds the request, calls the provider API).",
        },
        criteria,
      },
    }));
  },
  decide(answer, spec, options) {
    const declared = spec.subject as string | undefined;
    if (answer.type !== "choice" || !declared || answer.choice === declared) return undefined;
    if (answer.confidence < options.minConfidence) return undefined;
    return {
      anchor: spec.anchor,
      score: answer.confidence,
      message: `Span is declared ${declared} but the wrapped function behaves like a ${answer.choice} span (p=${(answer.probabilities[answer.choice] ?? 0).toFixed(2)}). Use the matching kind so Phoenix renders and evaluates it correctly.`,
    };
  },
});
