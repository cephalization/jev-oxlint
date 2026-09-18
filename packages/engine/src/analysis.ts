/**
 * Read the local request/response records the rule writes, and join them.
 * This is what `jev-lint survey` and `jev-lint calibrate` consume.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Answer, SystemOneRequest, SystemOneResponse } from "./jev/types.js";

export interface Record_ {
  hash: string;
  filename: string;
  request: SystemOneRequest;
  response?: SystemOneResponse;
  kind: "routing" | "detailed";
}

export function readRecords(cacheDir: string): Record_[] {
  const reqDir = path.join(cacheDir, "requests");
  const resDir = path.join(cacheDir, "responses");
  if (!existsSync(reqDir)) return [];
  return readdirSync(reqDir).map((f) => {
    const hash = f.replace(/\.json$/, "");
    const { filename, request } = JSON.parse(readFileSync(path.join(reqDir, f), "utf8")) as {
      filename: string;
      request: SystemOneRequest;
    };
    const resFile = path.join(resDir, f);
    const response = existsSync(resFile)
      ? (JSON.parse(readFileSync(resFile, "utf8")) as SystemOneResponse)
      : undefined;
    const state = request.state as { index?: unknown };
    return { hash, filename, request, response, kind: state.index ? "routing" : "detailed" };
  });
}

export interface RelevanceRow {
  reference: string;
  /** files scoring >= threshold */
  relevantFiles: string[];
  /** mean relevance over all files */
  meanRelevance: number;
}

export function summarizeRouting(records: Record_[], threshold: number): RelevanceRow[] {
  const byRef = new Map<string, { files: string[]; scores: number[] }>();
  for (const r of records) {
    if (r.kind !== "routing" || !r.response) continue;
    for (const [key, answer] of Object.entries(r.response.answers)) {
      if (!key.startsWith("relevant__") || answer.type !== "noul") continue;
      const ref = key.replace("relevant__", "");
      const row = byRef.get(ref) ?? { files: [], scores: [] };
      row.scores.push(answer.noul);
      if (answer.noul >= threshold) row.files.push(r.filename);
      byRef.set(ref, row);
    }
  }
  return [...byRef.entries()]
    .map(([reference, { files, scores }]) => ({
      reference,
      relevantFiles: files.sort(),
      meanRelevance: scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length),
    }))
    .sort(
      (a, b) =>
        b.relevantFiles.length - a.relevantFiles.length || b.meanRelevance - a.meanRelevance,
    );
}

export type AnswerKey = Record<string, Record<string, Answer>>;

export interface CalibrationRow {
  file: string;
  question: string;
  expected: string;
  actual: string;
  /** For Noul: |actual - expected|; for Choice: 0 if same choice else 1. */
  distance: number;
  ok: boolean;
}

function describe(a: Answer): string {
  if (a.type === "noul") return `noul=${a.noul.toFixed(2)}`;
  if (a.type === "choice") return `${a.choice} (conf ${a.confidence.toFixed(2)})`;
  return `score=${a.score}`;
}

/** Compare recorded answers to a human answer key (keyed by file basename, then question key). */
export function calibrate(
  records: Record_[],
  key: AnswerKey,
  noulTolerance = 0.25,
): CalibrationRow[] {
  const rows: CalibrationRow[] = [];
  for (const r of records) {
    if (!r.response) continue;
    const base = path.basename(r.filename);
    const expectedAnswers = key[base];
    if (!expectedAnswers) continue;
    for (const [q, expected] of Object.entries(expectedAnswers)) {
      const actual = r.response.answers[q];
      if (!actual) continue;
      let distance = 1;
      if (expected.type === "noul" && actual.type === "noul")
        distance = Math.abs(actual.noul - expected.noul);
      else if (expected.type === "choice" && actual.type === "choice")
        distance = actual.choice === expected.choice ? 0 : 1;
      rows.push({
        file: base,
        question: q,
        expected: describe(expected),
        actual: describe(actual),
        distance,
        ok: expected.type === "noul" ? distance <= noulTolerance : distance === 0,
      });
    }
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.question.localeCompare(b.question));
}
