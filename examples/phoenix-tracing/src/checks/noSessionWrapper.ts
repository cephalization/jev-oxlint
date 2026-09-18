import { defineCheck } from "@jev-oxlint/engine";

import { spanWrapperCalls } from "../spanHelpers.js";

export const noSessionWrapper = defineCheck({
  id: "no-session-wrapper",
  stateKey: "no_session_wrapper",
  title: "Set session.id via withSpan directly, not through a custom wrapper",
  guidance: [{ skill: "phoenix-tracing", file: "references/sessions-typescript.md" }],
  appliesTo: (facts) => spanWrapperCalls(facts).filter((c) => c.name === "withSpan"),
  precheck: (facts) => (facts.fileText.includes("session.id") ? "ask" : "skip"),
  questions: (_facts, anchors) => [
    {
      key: "no_session_wrapper",
      anchor: anchors[0],
      question: {
        type: "noul",
        instructions: {
          question:
            "Does `code.text` define a reusable helper function whose purpose is to call withSpan and inject `session.id` on behalf of callers, instead of calling withSpan directly at each use site with the session attribute?",
          guidance: "`guidance.no_session_wrapper`",
        },
        criteria: {
          true: "A function/const is exported or reused that wraps withSpan and supplies `session.id` (or the SESSION_ID constant) so callers do not pass it themselves.",
          false:
            "withSpan is called directly where spans are created, with `session.id` passed in that call's attributes; or session.id is set through the OpenTelemetry context API.",
        },
      },
    },
  ],
  decide(answer, spec, options) {
    if (answer.type !== "noul" || answer.noul < options.threshold) return undefined;
    return {
      anchor: spec.anchor,
      score: answer.noul,
      message:
        'Custom wrapper around withSpan for session.id. Call withSpan directly with `attributes: { "session.id": SESSION_ID }` at each use site.',
    };
  },
});
