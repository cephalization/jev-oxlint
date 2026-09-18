import { fileURLToPath } from "node:url";

import { defineLinter } from "@jev-oxlint/engine";

import { esmManualInstrumentation } from "./checks/esmManualInstrumentation.js";
import { flushBeforeExit } from "./checks/flushBeforeExit.js";
import { noSensitiveSpanAttributes } from "./checks/noSensitiveSpanAttributes.js";
import { noSessionWrapper } from "./checks/noSessionWrapper.js";
import { spanKindMatchesBody } from "./checks/spanKindMatchesBody.js";
import { annotationIdentifierCollision } from "./checks/annotationIdentifierCollision.js";

export const PHOENIX_OTEL = "@arizeai/phoenix-otel";
export const OPENINFERENCE_CORE = "@arizeai/openinference-core";

export const linter = defineLinter({
  name: "phoenix",
  packageRoot: fileURLToPath(new URL("..", import.meta.url)),
  skills: {
    dir: "skills",
    skill: "phoenix-tracing",
    // Upstream to copy from with `pnpm sync-skills` (Phoenix monorepo checkout).
    source: {
      dir: process.env.PHOENIX_REPO
        ? `${process.env.PHOENIX_REPO}/.agents/skills/phoenix-tracing`
        : "../../../phoenix/.agents/skills/phoenix-tracing",
      include: [
        /^SKILL\.md$/,
        /^references\/.*-typescript\.md$/,
        /^references\/span-.*\.md$/,
        /^references\/fundamentals-.*\.md$/,
      ],
    },
  },
  facts: {
    targets:
      /^(@arizeai\/(phoenix-otel|phoenix-client|openinference-[\w-]+)|@opentelemetry\/[\w-]+)(\/.*)?$/,
    contextImports:
      /^(openai|@langchain\/[\w-]+|langchain|@anthropic-ai\/sdk|@google\/genai|@mastra\/core|ai|@ai-sdk\/[\w-]+)(\/.*)?$/,
    trackMemberCalls: ["shutdown", "forceFlush", "manuallyInstrument"],
    trackProcessEvents: true,
    flagProperties: ["hideInputs", "hideOutputs", "hideInputMessages", "hideOutputMessages"],
    flagTextPatterns: { OPENINFERENCE_HIDE_env: /OPENINFERENCE_HIDE_/ },
  },
  checks: [
    flushBeforeExit,
    spanKindMatchesBody,
    noSessionWrapper,
    esmManualInstrumentation,
    noSensitiveSpanAttributes,
    annotationIdentifierCollision,
  ],
});
