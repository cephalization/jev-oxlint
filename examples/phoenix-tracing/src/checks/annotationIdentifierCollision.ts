// Drafted by `jev-lint propose` (claude-opus-5) from references/annotations-typescript.md,
// then reviewed by hand: one redundant type cast removed, nothing else changed.
import {
  callIndex,
  callsFrom,
  defineCheck,
  entry,
  objectArg,
  pViolation,
  type CallFact,
  type ObjectEntry,
} from "@jev-oxlint/engine";

/** Modules that expose the structured annotation writers. */
const ANNOTATION_MODULES = /^@arizeai\/phoenix-client\/(spans|traces|sessions)$/;

/**
 * Structured annotation writers only.
 *
 * Notes (`addSpanNote`, `addTraceNote`, `logSpanNotes`, ...) are deliberately excluded:
 * each note call mints its own UUIDv4 identifier, so notes are append-only and can
 * never collide with one another.
 */
const ANNOTATION_WRITERS = [
  "addSpanAnnotation",
  "logSpanAnnotations",
  "addDocumentAnnotation",
  "logDocumentAnnotations",
  "addTraceAnnotation",
  "logTraceAnnotations",
  "addSessionAnnotation",
  "logSessionAnnotations",
] as const;

/** The option key that carries the annotation payload for each writer. */
const PAYLOAD_KEYS = [
  "spanAnnotation",
  "spanAnnotations",
  "documentAnnotation",
  "documentAnnotations",
  "traceAnnotation",
  "traceAnnotations",
  "sessionAnnotation",
  "sessionAnnotations",
] as const;

/** Entries of a nested object literal, when the engine recorded them. */
const nestedEntries = (e: ObjectEntry | undefined): ObjectEntry[] | undefined => e?.entries;

const payloadEntry = (call: CallFact): ObjectEntry | undefined => {
  const top = objectArg(call, 0)?.entries;
  for (const key of PAYLOAD_KEYS) {
    const found = entry(top, key);
    if (found) return found;
  }
  return undefined;
};

/**
 * True only when the payload is an inline object literal that sets `identifier`.
 * Batch payloads passed as an expression (`spanAnnotations`) are not decidable here.
 */
const hasInlineIdentifier = (call: CallFact): boolean =>
  entry(nestedEntries(payloadEntry(call)), "identifier") !== undefined;

export const annotationIdentifierCollision = defineCheck({
  id: "annotation-identifier-collision",
  stateKey: "annotation_identifier",
  title: "Annotations that must accumulate need a distinct identifier",
  guidance: [{ skill: "phoenix-tracing", file: "references/annotations-typescript.md" }],
  appliesTo: (facts) => callsFrom(facts, ANNOTATION_MODULES, ANNOTATION_WRITERS),
  precheck(_facts, anchors) {
    // Every write already names its own key: (name, target id, identifier) cannot collide.
    if (anchors.every((a) => hasInlineIdentifier(a))) return "skip";
    return "ask";
  },
  questions(facts, anchors) {
    return anchors
      .filter((anchor) => !hasInlineIdentifier(anchor))
      .map((anchor) => {
        const i = callIndex(facts, anchor);
        return {
          key: `annotation_identifier:${i}`,
          anchor,
          subject: anchor.name,
          question: {
            type: "noul" as const,
            instructions: {
              question:
                "Judging only `code.text`, is every annotation written by this call uniquely keyed — i.e. no two annotations that are meant to coexist can share the same annotation `name`, the same target id, and the same `identifier`?",
              guidance: "`guidance.annotation_identifier`",
              inspect: [
                `\`code.calls[${i}]\` — the call text and line`,
                `\`code.calls[${i}].args[0].entries\` — the options passed to this writer, including whether \`identifier\` is set inline`,
                "`code.text` — how the annotation objects are built: loops over reviewers/evaluators, `.map()` over results, repeated runs of this script",
                "`facts.calls` — the other Phoenix annotation writes in this file",
              ],
            },
            criteria: {
              true: "Either this call writes at most one annotation per (name, target id) per run and a rerun is meant to replace the previous value, or every annotation object it sends sets an `identifier` that varies per annotator, per evaluator pass, or per run.",
              false:
                "Annotations that are meant to accumulate (one per reviewer, per evaluator, per retry) can reach the same `name` and the same target id with no `identifier` or a constant one, so each write silently overwrites the previous entry.",
            },
          },
        };
      });
  },
  decide(answer, spec, options) {
    const p = pViolation(answer);
    if (p === undefined || p < options.threshold) return undefined;
    const name = spec.anchor?.name ?? "this annotation write";
    return {
      anchor: spec.anchor,
      score: p,
      message: `${name}() can write several annotations with the same name to the same target without a distinct \`identifier\`; annotations are keyed by (name, target id, identifier), so earlier entries are silently overwritten. Set a per-annotator/per-run \`identifier\`, or use an append-only note (addSpanNote/addTraceNote) for free-form feedback.`,
    };
  },
});
