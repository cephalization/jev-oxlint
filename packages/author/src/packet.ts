/**
 * The proposal packet: everything a proposer (model or person) needs to draft
 * one check for one guidance file. Built from the recorded routing/detailed
 * requests of a survey run, so the code samples are exactly what jev sees
 * (redacted), plus the guidance text, the engine's check contract, and a
 * worked example check.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { AnalysisRecord } from "@jev-oxlint/engine";
import { checkContractPath } from "@jev-oxlint/engine";

import { EXAMPLE_CHECK } from "./exampleCheck.js";

export interface LinterInfo {
  name?: string;
  skill?: string;
  targets?: string;
  references: string[];
}

export interface Packet {
  stem: string;
  guidanceFile: string;
  relevantCount: number;
  surveyedCount: number;
  markdown: string;
}

const relevanceOf = (r: AnalysisRecord, stem: string): number =>
  (r.response?.answers[`relevant__${stem}`] as { noul?: number } | undefined)?.noul ?? 0;

export function buildPacket(
  records: AnalysisRecord[],
  guidancePath: string,
  threshold: number,
  linter: LinterInfo,
  maxSamples = 5,
): Packet {
  const stem = path.basename(guidancePath, ".md");
  const guidanceFile = `references/${path.basename(guidancePath)}`;
  const surveyed = new Set(records.map((r) => r.filename)).size;
  const relevant = records
    .filter((r) => r.kind === "routing" && relevanceOf(r, stem) >= threshold)
    .sort((a, b) => relevanceOf(b, stem) - relevanceOf(a, stem));
  const samples = relevant.slice(0, maxSamples).map((r) => {
    const detailed = records.find((d) => d.kind === "detailed" && d.filename === r.filename);
    const code = (r.request.state as { code: { text: string } }).code.text;
    const calls = detailed
      ? JSON.stringify((detailed.request.state as { code: { calls: unknown } }).code.calls, null, 2)
      : "[]";
    return [
      `### ${path.relative(process.cwd(), r.filename)} (relevance ${relevanceOf(r, stem).toFixed(2)})`,
      "",
      "```ts",
      code,
      "```",
      "",
      "`code.calls` as the engine extracts them:",
      "",
      "```json",
      calls,
      "```",
    ].join("\n");
  });

  const markdown = [
    `# Proposal context: ${guidanceFile}`,
    "",
    `Skill: \`${linter.skill ?? "?"}\`. Plugin name: \`${linter.name ?? "?"}\`. Target import pattern: \`${linter.targets ?? "?"}\`.`,
    `Routing found this guidance relevant (≥ ${threshold}) to ${relevant.length} of ${surveyed} surveyed in-scope file(s). No existing check cites it.`,
    "",
    "## What to produce",
    "",
    "ONE check in the `@jev-oxlint/engine` `Check` shape (contract below, worked example after it):",
    "- `appliesTo` and `precheck` are deterministic, using only the generic facts (`facts.calls` with `args[].entries`, `facts.memberCalls`, `facts.processHandlers`, `facts.exportedNames`, `facts.flags`, `facts.contextImports`). If the check genuinely needs a fact the engine does not extract, say so in `factsNeeded` and write the best check possible without it.",
    "- Questions are narrow and atomic (one property each), Noul or Choice, and point into `state` by path: `code.calls[i]` (use `callIndex(facts, anchor)`), `code.calls[i].args[k].entries`, `facts.*`, and `guidance.<stateKey>`. Put facts in state and keep questions short; do not restate a candidate answer in the question.",
    "- `decide` maps probabilities to a finding deterministically. Use `options.threshold` for Noul and `options.minConfidence` for Choice.",
    "- `guidance` cites files by path from the list below; the file this proposal is for must be among them.",
    "- String literals in linted code are redacted to `<str:N>` before jev sees them, so identifiers, member expressions and property keys carry the meaning. `kind`/`name`/`type` option values survive.",
    "- Import only from `@jev-oxlint/engine` and node builtins. Strict TypeScript, ESM, `.js` import suffixes. Export the check as a named const.",
    "",
    "Also produce fixtures: at least one violation, one correct version, and one trap a naive keyword rule would get wrong. Each fixture must import a target package so it is in scope, and must be realistic application code. And an answer key: the jev answers a careful human reviewer expects for every question the check asks about each fixture (question keys exactly as `questions()` generates them).",
    "",
    "Questions and thresholds are what a reviewer reads first; make them precise.",
    "",
    "## Guidance to enforce",
    "",
    readFileSync(guidancePath, "utf8").trim(),
    "",
    "## Guidance files available for citation",
    "",
    ...linter.references.map((f) => `- \`${f}\``),
    "",
    "## Sample in-scope files (redacted exactly as jev sees them)",
    "",
    ...(samples.length > 0
      ? samples
      : ["_No surveyed file scored above the threshold; draft from the guidance alone._"]),
    "",
    "## Check contract (`@jev-oxlint/engine`)",
    "",
    "```ts",
    readFileSync(checkContractPath(), "utf8").trim(),
    "```",
    "",
    "## Worked example check",
    "",
    "```ts",
    EXAMPLE_CHECK.trim(),
    "```",
  ].join("\n");

  return { stem, guidanceFile, relevantCount: relevant.length, surveyedCount: surveyed, markdown };
}
