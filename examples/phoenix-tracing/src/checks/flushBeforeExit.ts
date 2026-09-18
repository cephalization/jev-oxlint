import {
  callIndex,
  callsFrom,
  defineCheck,
  entry,
  isExported,
  literalBoolean,
  objectArg,
} from "@jev-oxlint/engine";

import { PHOENIX_OTEL } from "../linter.js";

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
    // Custom processors may or may not batch — a judgement call for jev.
    if (anchors.some((a) => entry(options(a), "spanProcessors"))) return "ask";
    return {
      violation: {
        anchor: anchors[0],
        score: 1,
        message:
          "register() is called but the returned provider is never flushed (no shutdown()/forceFlush()) and not exported for a caller to flush. Queued spans are dropped when the process exits.",
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
            "Judging only the code in `code.text`, are spans queued by the tracer provider returned from register() flushed on every path by which this process can end: normal completion, a thrown error or rejected promise, and termination signals?",
          guidance: "`guidance.flush_before_exit`",
          inspect: [
            `\`code.calls[${callIndex(facts, anchors[0]!)}].args[0]\` — if \`batch\` is false, or \`spanProcessors\` are all Simple (non-batching) processors, spans export as they end and no flush is required`,
            "`facts.memberCalls` — every shutdown()/forceFlush() call and its line",
            "`facts.processHandlers` — which process events are handled",
            "whether the only flush sits on the success path (end of main()) with no catch/finally or signal handler that also flushes",
          ],
          note: "A long-running server that flushes on SIGTERM/SIGINT counts as covered. A script whose flush is reached only when main() resolves does not.",
        },
        criteria: {
          true: "Every realistic exit path — success, error, and the termination signals relevant to this kind of program — reaches a flush or shutdown of the provider.",
          false:
            "At least one realistic exit path skips the flush: e.g. errors are caught and the process exits without flushing, or the flush runs only when the happy path completes.",
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
      message:
        "Spans may be dropped on exit: the provider from register() is not flushed on every exit path (success, error, and signals).",
    };
  },
});
