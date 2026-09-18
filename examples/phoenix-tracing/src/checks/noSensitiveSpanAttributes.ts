import type { EntryType, Finding, ObjectEntry, QuestionSpec } from "@jev-oxlint/engine";
import { callIndex, defineCheck } from "@jev-oxlint/engine";

import {
  dynamicAttributes,
  processInput,
  processOutput,
  spanAttributes,
  spanWrapperCalls,
} from "../spanHelpers.js";

const HARDCODED_MIN_LENGTH = 20;

const SENSITIVE_TRUE: EntryType = {
  what: "The value denotes data about a person (identity, contact details, date of birth, government id, free text about them, health or financial detail) or a secret (API key, bearer token, password, cookie, raw request headers).",
  examples: [
    "user.email",
    "patient.birthDate",
    "visit.notes.diagnosis",
    "payment.cardNumber",
    "process.env.OPENAI_API_KEY",
    "req.headers.authorization",
  ],
};
const SENSITIVE_FALSE: EntryType = {
  what: "Operational data: token counts, model names, latencies, retry counts, request/trace ids, ids or names of non-person entities, feature flags, sizes.",
  examples: [
    "usage.totalTokens",
    "prompt.length / 4",
    "response.model",
    "Date.now() - started",
    "requestId",
  ],
  note: "A *count* of tokens is not a token. Judge by what the identifier denotes, not by substrings.",
};

const hasDynamicData = (c: Parameters<typeof dynamicAttributes>[0]) =>
  dynamicAttributes(c).length > 0 ||
  processInput(c) !== undefined ||
  processOutput(c) !== undefined;

export const noSensitiveSpanAttributes = defineCheck({
  id: "no-sensitive-span-attributes",
  stateKey: "no_sensitive_span_attributes",
  title: "Personal or secret data does not flow into span attributes unmasked",
  guidance: [
    { skill: "phoenix-tracing", file: "references/production-typescript.md" },
    { skill: "phoenix-tracing", file: "references/fundamentals-universal-attributes.md" },
  ],
  appliesTo: (facts) =>
    spanWrapperCalls(facts).filter(
      (c) =>
        spanAttributes(c).length > 0 ||
        processInput(c) !== undefined ||
        processOutput(c) !== undefined,
    ),
  precheck(_facts, anchors) {
    // Hardcoded literals never flow at runtime and are never sent to jev; a
    // long one is almost certainly a token or key pasted into an attribute.
    const violations: Finding[] = [];
    for (const anchor of anchors) {
      for (const attr of spanAttributes(anchor)) {
        if (attr.valueKind === "literal" && (attr.literalLength ?? 0) >= HARDCODED_MIN_LENGTH) {
          violations.push({
            anchor,
            score: 1,
            message: `Span attribute "${attr.key}" is a hardcoded ${attr.literalLength}-character string literal (line ${attr.line}). Long literals in attributes are usually pasted secrets; read it from configuration and keep it out of spans. (Value was not sent to jev.)`,
          });
        }
      }
    }
    return { violations, then: anchors.some(hasDynamicData) ? "ask" : "skip" };
  },
  questions(facts, anchors) {
    const specs: QuestionSpec[] = [];
    anchors.filter(hasDynamicData).forEach((anchor, i) => {
      const ci = callIndex(facts, anchor);
      dynamicAttributes(anchor).forEach((attr, j) => {
        specs.push({
          key: `sensitive_${i}_attr_${j}`,
          anchor,
          subject: attr,
          question: {
            type: "noul",
            instructions: {
              question: `Does the value flowing at runtime into the span attribute \`${attr.key}\` of \`code.calls[${ci}]\` (value expression \`${attr.valueText}\`) denote personal, health, financial or secret data?`,
              guidance: "`guidance.no_sensitive_span_attributes`",
              note: "Custom attributes are never masked by OpenInference; only input/output values are.",
            },
            criteria: { true: SENSITIVE_TRUE, false: SENSITIVE_FALSE },
          },
        });
      });
      if (processInput(anchor) !== undefined || processOutput(anchor) !== undefined) {
        specs.push({
          key: `sensitive_${i}_bulk`,
          anchor,
          question: {
            type: "noul",
            instructions: {
              question: `Do the \`processInput\` / \`processOutput\` options of \`code.calls[${ci}]\` serialize an entire record or object wholesale (JSON.stringify(record), getInputAttributes(object), spreading it), such that any personal or secret fields it holds land in the span?`,
              guidance: "`guidance.no_sensitive_span_attributes`",
            },
            criteria: {
              true: {
                what: "A whole object/record is captured: JSON.stringify(visit), getInputAttributes(user), { ...customer }.",
              },
              false: {
                what: "Only a plain string (prompt, answer text) or a small hand-picked operational object is captured.",
                examples: [
                  "getInputAttributes(input) where input is a string prompt",
                  "getOutputAttributes(result.text)",
                ],
              },
            },
          },
        });
      }
    });
    return specs;
  },
  decide(answer, spec, options, facts) {
    if (answer.type !== "noul" || answer.noul < options.threshold) return undefined;
    const masked = Object.keys(facts.flags).length > 0;
    if (spec.key.endsWith("_bulk")) {
      // Masking covers input/output values, so wholesale serialization is fine when it is on.
      if (masked) return undefined;
      return {
        anchor: spec.anchor,
        score: answer.noul,
        message:
          "processInput/processOutput serialize a whole record into the span, so any personal fields it holds are captured. Pick the fields you need, or enable traceConfig.hideInputs/hideOutputs or the OPENINFERENCE_HIDE_* variables.",
      };
    }
    const attr = spec.subject as ObjectEntry;
    return {
      anchor: spec.anchor,
      score: answer.noul,
      message: `Span attribute "${attr.key}" carries personal, health, financial or secret data (${attr.valueText}). Custom attributes are never masked; drop it or replace it with a non-identifying id.`,
    };
  },
});
