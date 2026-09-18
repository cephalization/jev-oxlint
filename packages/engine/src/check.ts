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
  | "ask"
  | "skip"
  | { violation: Finding }
  | { violations: Finding[]; then: "ask" | "skip" };

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
