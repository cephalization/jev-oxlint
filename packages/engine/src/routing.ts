/**
 * Guidance routing and the hint tier. One cheap request asks a Noul per
 * bundled reference file, "does this apply to this code?", with the skill's
 * SKILL.md as the index. Relevant files no applied check covers get a coarse
 * follow/deviate question in the detailed request, surfaced as a hint.
 */
import type { Facts } from "./facts.js";
import type { GuidanceRef, GuidanceStore } from "./guidance.js";
import { guidanceSource } from "./guidance.js";
import type { ChoiceQuestion, EntryType, NoulQuestion, SystemOneResponse } from "./jev/types.js";

export interface Routable {
  ref: GuidanceRef;
  stem: string;
}

export const routingKey = (g: Routable) => `relevant__${g.stem}`;
export const hintKey = (g: Routable) => `hint__${g.stem}`;

export function listRoutable(store: GuidanceStore, skill: string): Routable[] {
  return store
    .listReferences(skill)
    .map((ref) => ({ ref, stem: ref.file.replace(/^references\//, "").replace(/\.md$/, "") }));
}

export const ROUTING_RUBRIC: EntryType = {
  question_asked_per_file:
    "Is this guidance file relevant to what `code.text` does with the packages in `imports`?",
  relevant:
    "A reviewer would want the file open while reviewing this code: the code performs, configures, or visibly omits something the file describes.",
  not_relevant:
    "The file covers a different language, a span kind not used here, or a scenario this code does not attempt. 'Same product' alone is not relevance.",
};

export function buildRoutingState(
  store: GuidanceStore,
  skill: string,
  codeText: string,
  redactionNote: string,
  facts: Facts,
): Record<string, EntryType> {
  const index = store.load({ skill, file: "SKILL.md" });
  return {
    code: { redaction: redactionNote, text: codeText },
    imports: facts.imports.map((i) => ({ source: i.source, name: i.imported })),
    rubric: ROUTING_RUBRIC,
    index: {
      source: index.source,
      note: "The skill's index. Each bullet names a reference file and says what it covers.",
      text: index.text,
    },
  };
}

export function buildRoutingQuestions(routable: Routable[]): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  for (const g of routable) {
    questions[routingKey(g)] = {
      type: "noul",
      instructions: `Per \`rubric\`, is \`${g.ref.file}\` (see \`index.text\`) relevant to \`code.text\`?`,
    };
  }
  return questions;
}

export interface Hint {
  guidance: Routable;
  relevance: number;
}

export function selectHints(
  routable: Routable[],
  routing: SystemOneResponse,
  alreadyCited: Set<string>,
  routeThreshold: number,
  maxHints: number,
): Hint[] {
  const hints: Hint[] = [];
  for (const g of routable) {
    const answer = routing.answers[routingKey(g)];
    if (!answer || answer.type !== "noul" || answer.noul < routeThreshold) continue;
    if (alreadyCited.has(guidanceSource(g.ref))) continue;
    hints.push({ guidance: g, relevance: answer.noul });
  }
  return hints.sort((a, b) => b.relevance - a.relevance).slice(0, maxHints);
}

export function buildHintQuestion(hint: Hint, index: number): ChoiceQuestion {
  return {
    type: "choice",
    instructions: {
      question: `Judged against \`guidance.hints[${index}].text\` (${hint.guidance.ref.file}), how does \`code.text\` relate to that guidance?`,
      note: "This is a coarse read, not a specific rule. Prefer `not_applicable` over `deviates` when the guidance describes a scenario the code does not attempt.",
    },
    criteria: {
      follows: {
        what: "Where the guidance applies, the code does what it says (or an equivalent the guidance permits).",
      },
      deviates: {
        what: "The code does something the guidance says not to do, or omits something the guidance marks as required or critical for code like this.",
      },
      not_applicable: {
        what: "On closer reading the guidance concerns a scenario this code does not attempt.",
      },
    },
  };
}
