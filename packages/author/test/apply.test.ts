import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyProposal, registerCheck } from "../src/apply.js";
import type { Proposal } from "../src/propose.js";

const proposal: Proposal = {
  check: {
    id: "no-foo",
    exportName: "noFoo",
    fileName: "noFoo.ts",
    title: "No foo",
    source: 'export const noFoo = { id: "no-foo" };',
  },
  fixtures: [
    {
      fileName: "bad-foo.ts",
      purpose: "violation",
      source: 'import { x } from "@my/sdk";\nfoo();',
    },
    { fileName: "good-foo.ts", purpose: "correct", source: 'import { x } from "@my/sdk";\nbar();' },
  ],
  answerKey: [
    { fixture: "bad-foo.ts", question: "no_foo", answer: { type: "noul", noul: 0.95 } },
    {
      fixture: "good-foo.ts",
      question: "kind_0",
      answer: {
        type: "choice",
        choice: "A",
        confidence: 0.8,
        probabilities: [
          { option: "A", p: 0.85 },
          { option: "B", p: 0.15 },
        ],
      },
    },
  ],
  review: { summary: "s", questionsToReview: ["q"], thresholds: "t", factsNeeded: [] },
};

describe("registerCheck", () => {
  it("adds to the scaffold's empty checks array and imports the module", () => {
    const src =
      'import { defineLinter } from "@jev-oxlint/engine";\n\nconst checks = [] as const;\n\nexport const linter = defineLinter({ checks });\n';
    const out = registerCheck(src, "noFoo", "noFoo.ts")!;
    expect(out).toContain('import { noFoo } from "./checks/noFoo.js";');
    expect(out).toContain("const checks = [noFoo];");
  });
  it("appends to an inline checks array", () => {
    const src =
      'import { a } from "./checks/a.js";\nexport const linter = defineLinter({\n  checks: [a, b],\n});\n';
    const out = registerCheck(src, "noFoo", "noFoo.ts")!;
    expect(out).toContain("checks: [a, b, noFoo]");
    expect(out.indexOf("import { noFoo }")).toBeGreaterThan(out.indexOf("import { a }"));
  });
  it("is idempotent and returns undefined for unknown shapes", () => {
    const once = registerCheck("const checks = [] as const;", "noFoo", "noFoo.ts")!;
    expect(registerCheck(once, "noFoo", "noFoo.ts")).toBe(once);
    expect(registerCheck("export const linter = 1;", "noFoo", "noFoo.ts")).toBeUndefined();
  });
});

describe("applyProposal", () => {
  it("writes check, fixtures, merged answer key, review note, and registers", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jev-apply-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src", "linter.ts"), "const checks = [] as const;\n");
    writeFileSync(
      path.join(dir, "answer-key.json"),
      JSON.stringify({ "bad-foo.ts": { other: { type: "noul", noul: 0.1 } } }),
    );
    const applied = applyProposal(dir, proposal, "PACKET", {
      model: "m",
      guidanceFile: "references/x.md",
    });
    expect(applied.registered).toBe(true);
    expect(applied.written).toEqual(
      expect.arrayContaining([
        "src/checks/noFoo.ts",
        "fixtures/bad-foo.ts",
        "fixtures/good-foo.ts",
        "answer-key.json",
        "proposals/no-foo.md",
        "src/linter.ts",
      ]),
    );
    const key = JSON.parse(readFileSync(path.join(dir, "answer-key.json"), "utf8"));
    expect(key["bad-foo.ts"]).toEqual({
      other: { type: "noul", noul: 0.1 },
      no_foo: { type: "noul", noul: 0.95 },
    });
    expect(key["good-foo.ts"].kind_0.probabilities).toEqual({ A: 0.85, B: 0.15 });
    const note = readFileSync(path.join(dir, "proposals", "no-foo.md"), "utf8");
    expect(note).toContain("Review the questions and thresholds");
    expect(note).toContain("PACKET");
  });
});
