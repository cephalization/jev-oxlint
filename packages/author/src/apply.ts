/**
 * Write a proposal into a linter package: the check module, fixtures, merged
 * answer-key entries, a review note, and (best effort) registration of the
 * check in `src/linter.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Proposal } from "./propose.js";

export interface Applied {
  written: string[];
  registered: boolean;
  reviewNote: string;
}

type AnswerKeyFile = Record<string, Record<string, unknown>>;

function toWireAnswer(a: Proposal["answerKey"][number]["answer"]): unknown {
  if (a.type === "noul") return a;
  return {
    type: "choice",
    choice: a.choice,
    confidence: a.confidence,
    probabilities: Object.fromEntries(a.probabilities.map((p) => [p.option, p.p])),
  };
}

/** Insert an import and a `checks` array entry into src/linter.ts. Returns false if the file's shape was not recognised. */
export function registerCheck(
  linterTs: string,
  exportName: string,
  fileName: string,
): string | undefined {
  const importLine = `import { ${exportName} } from "./checks/${fileName.replace(/\.ts$/, ".js")}";`;
  if (linterTs.includes(importLine)) return linterTs;
  let out = linterTs;
  // Scaffold shape: `const checks = [] as const;` or `const checks = [a, b] as const;`
  const scaffold = /const checks = \[([^\]]*)\]( as const)?;/;
  const inline = /checks: \[([^\]]*)\]/;
  if (scaffold.test(out)) {
    out = out.replace(
      scaffold,
      (_m, inner: string) =>
        `const checks = [${inner.trim() ? `${inner.trim().replace(/,\s*$/, "")}, ` : ""}${exportName}];`,
    );
  } else if (inline.test(out)) {
    out = out.replace(
      inline,
      (_m, inner: string) =>
        `checks: [${inner.trim() ? `${inner.trim().replace(/,\s*$/, "")}, ` : ""}${exportName}]`,
    );
  } else {
    return undefined;
  }
  // Add the import after the last import statement.
  const lastImport = [...out.matchAll(/^import [^;]+;$/gm)].pop();
  if (lastImport && lastImport.index !== undefined) {
    const at = lastImport.index + lastImport[0].length;
    out = `${out.slice(0, at)}\n${importLine}${out.slice(at)}`;
  } else {
    out = `${importLine}\n${out}`;
  }
  return out;
}

export function applyProposal(
  linterDir: string,
  proposal: Proposal,
  packetMarkdown: string,
  meta: { model: string; guidanceFile: string },
): Applied {
  const written: string[] = [];
  const write = (rel: string, text: string) => {
    const file = path.join(linterDir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
    written.push(rel);
  };

  write(path.join("src", "checks", proposal.check.fileName), proposal.check.source);
  for (const f of proposal.fixtures) write(path.join("fixtures", f.fileName), f.source);

  const keyPath = path.join(linterDir, "answer-key.json");
  const key: AnswerKeyFile = existsSync(keyPath)
    ? (JSON.parse(readFileSync(keyPath, "utf8")) as AnswerKeyFile)
    : {};
  for (const entry of proposal.answerKey) {
    key[entry.fixture] = {
      ...(key[entry.fixture] ?? {}),
      [entry.question]: toWireAnswer(entry.answer),
    };
  }
  write("answer-key.json", JSON.stringify(key, null, 2));

  const reviewNote = [
    `# Proposed check: ${proposal.check.id}`,
    "",
    `Drafted by ${meta.model} from \`${meta.guidanceFile}\`. **Review the questions and thresholds before anything else.**`,
    "",
    "## Summary",
    "",
    proposal.review.summary,
    "",
    "## Questions to review",
    "",
    ...proposal.review.questionsToReview.map((q) => `- ${q}`),
    "",
    "## Thresholds",
    "",
    proposal.review.thresholds,
    "",
    "## Facts the engine does not extract yet",
    "",
    ...(proposal.review.factsNeeded.length
      ? proposal.review.factsNeeded.map((f) => `- ${f}`)
      : ["- none"]),
    "",
    "## Fixtures",
    "",
    ...proposal.fixtures.map((f) => `- \`fixtures/${f.fileName}\` — ${f.purpose}`),
    "",
    "## Next",
    "",
    "```bash",
    "pnpm build && jev-lint calibrate --plugin dist/index.js --key answer-key.json fixtures",
    "```",
    "",
    "<details><summary>Packet the model received</summary>",
    "",
    packetMarkdown,
    "",
    "</details>",
  ].join("\n");
  write(path.join("proposals", `${proposal.check.id}.md`), reviewNote);

  let registered = false;
  const linterTs = path.join(linterDir, "src", "linter.ts");
  if (existsSync(linterTs)) {
    const updated = registerCheck(
      readFileSync(linterTs, "utf8"),
      proposal.check.exportName,
      proposal.check.fileName,
    );
    if (updated) {
      writeFileSync(linterTs, updated);
      written.push("src/linter.ts");
      registered = true;
    }
  }
  return { written, registered, reviewNote };
}
