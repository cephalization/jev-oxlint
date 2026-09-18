/** A complete, real check from the Phoenix example, shown to proposers as the target shape. */
export const EXAMPLE_CHECK = `
import { callIndex, callsFrom, defineCheck, entry, isExported, literalBoolean, objectArg } from "@jev-oxlint/engine";

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
    // \`batch: false\` exports each span as it ends; guidance says no shutdown needed.
    if (anchors.every((a) => literalBoolean(entry(options(a), "batch")) === false)) return "skip";
    if (facts.memberCalls.some((m) => FLUSH_METHODS.has(m.method))) return "ask";
    // Handed to another module; flushing is its job (cross-file is out of scope).
    if (anchors.some((a) => isExported(facts, a))) return "skip";
    return {
      violation: {
        anchor: anchors[0],
        score: 1,
        message: "register() is called but the returned provider is never flushed and not exported for a caller to flush.",
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
          question: "Judging only \`code.text\`, are spans queued by the provider returned from register() flushed on every path by which this process can end: normal completion, a thrown error, and termination signals?",
          guidance: "\`guidance.flush_before_exit\`",
          inspect: [
            \`\\\`code.calls[\${callIndex(facts, anchors[0]!)}].args[0]\\\` — the register() options\`,
            "\`facts.memberCalls\` — every shutdown()/forceFlush() call and its line",
            "\`facts.processHandlers\` — which process events are handled",
          ],
        },
        criteria: {
          true: "Every realistic exit path reaches a flush or shutdown of the provider.",
          false: "At least one realistic exit path skips the flush, e.g. errors are caught and the process exits without flushing.",
        },
      },
    },
  ],
  decide(answer, spec, options) {
    if (answer.type !== "noul") return undefined;
    const p = 1 - answer.noul;
    if (p < options.threshold) return undefined;
    return { anchor: spec.anchor, score: p, message: "Spans may be dropped on exit: the provider is not flushed on every exit path." };
  },
});
`;
