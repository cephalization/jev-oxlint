import { callsFrom, defineCheck } from "@jev-oxlint/engine";

import { PHOENIX_OTEL } from "../linter.js";

export const esmManualInstrumentation = defineCheck({
  id: "esm-manual-instrumentation",
  stateKey: "esm_manual_instrumentation",
  title: "ESM modules instrument LLM libraries explicitly",
  guidance: [
    { skill: "phoenix-tracing", file: "references/setup-typescript.md" },
    { skill: "phoenix-tracing", file: "references/instrumentation-auto-typescript.md" },
  ],
  appliesTo: (facts) => callsFrom(facts, PHOENIX_OTEL, ["register"]),
  precheck: (facts) => (facts.contextImports.length > 0 ? "ask" : "skip"),
  questions: (_facts, anchors) => [
    {
      key: "esm_manual_instrumentation",
      anchor: anchors[0],
      question: {
        type: "choice",
        instructions: {
          question:
            "In this ES module, how are the LLM libraries listed in `facts.contextImports` made visible to Phoenix tracing?",
          guidance: "`guidance.esm_manual_instrumentation`",
          inspect: [
            "`facts.memberCalls` — any manuallyInstrument() call — and any registerInstrumentations() call in `code.text`",
            "import order in `code.text` — ESM imports are hoisted above register()",
            "whether the library emits OpenTelemetry natively (Vercel AI SDK `ai` via registerTelemetry / experimental_telemetry) so no OpenInference instrumentation is required",
          ],
        },
        criteria: {
          explicitly_instrumented: {
            what: "An OpenInference instrumentation is constructed and applied with manuallyInstrument()/registerInstrumentations() after register().",
          },
          native_telemetry: {
            what: "The library exports OpenTelemetry spans itself (e.g. Vercel AI SDK with telemetry enabled) so it needs no OpenInference instrumentation; register() is enough.",
          },
          relies_on_import_order: {
            what: "The library is imported in this module and expected to be auto-instrumented, but nothing calls manuallyInstrument()/registerInstrumentations(); under ESM hoisting the library loads before register() runs and its calls will not be traced.",
          },
        },
      },
    },
  ],
  decide(answer, spec, options) {
    if (answer.type !== "choice" || answer.choice !== "relies_on_import_order") return undefined;
    if (answer.confidence < options.minConfidence) return undefined;
    return {
      anchor: spec.anchor,
      score: answer.confidence,
      message:
        "ESM imports are hoisted above register(), so this library will not be auto-instrumented. Construct its OpenInference instrumentation and call manuallyInstrument() (see guidance).",
    };
  },
});
