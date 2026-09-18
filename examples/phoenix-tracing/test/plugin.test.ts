/**
 * End-to-end: run the real oxlint binary with the built plugin against the
 * fixtures, with jev replaced by the answer key (`OXLINT_JEV_MODE=mock`).
 * Requests are recorded, so this also pins the request shape.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const require = createRequire(import.meta.url);

interface Diagnostic {
  message: string;
  code: string;
  filename: string;
  labels: Array<{ span: { line: number; column: number } }>;
}

function oxlintBin(): string {
  const pkgDir = path.dirname(require.resolve("oxlint/package.json"));
  const { bin } = require("oxlint/package.json") as { bin: Record<string, string> };
  return path.join(pkgDir, bin.oxlint ?? "bin/oxlint");
}

let cacheDir: string;
let diagnostics: Diagnostic[];
const byFixture = (name: string) =>
  diagnostics.filter(
    (d) => d.filename.endsWith(`fixtures/${name}`) && d.code.startsWith("phoenix("),
  );
const requests = () =>
  readdirSync(path.join(cacheDir, "requests")).map(
    (f) =>
      JSON.parse(readFileSync(path.join(cacheDir, "requests", f), "utf8")) as {
        filename: string;
        request: { state: Record<string, unknown>; questions: Record<string, unknown> };
      },
  );

beforeAll(() => {
  cacheDir = mkdtempSync(path.join(os.tmpdir(), "jev-oxlint-test-"));
  const result = spawnSync(
    oxlintBin(),
    [
      "-c",
      "examples/phoenix-tracing/demo.oxlintrc.json",
      "--format",
      "json",
      "examples/phoenix-tracing/fixtures",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        OXLINT_JEV_MODE: "mock",
        OXLINT_JEV_CACHE_DIR: cacheDir,
        OXLINT_JEV_MOCK_FILE: path.join(pkgRoot, "answer-key.json"),
      },
    },
  );
  if (result.error) throw result.error;
  diagnostics = (JSON.parse(result.stdout) as { diagnostics: Diagnostic[] }).diagnostics;
});

describe("import gate", () => {
  it("never asks jev about files without target imports", () => {
    expect(byFixture("unrelated.ts")).toEqual([]);
    expect(requests().some((r) => r.filename.endsWith("unrelated.ts"))).toBe(false);
  });
});

describe("flush-before-exit", () => {
  it("reports deterministically when nothing can ever flush", () => {
    const found = byFixture("bad-no-flush.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("[jev:flush-before-exit]");
    expect(found[0]?.message).toContain("(p=1.00)");
    expect(found[0]?.labels[0]?.span.line).toBe(3);
  });
  it("skips exported providers and batch:false without asking jev", () => {
    expect(byFixture("exported-provider.ts")).toEqual([]);
    expect(
      byFixture("esm-import-order.ts").filter((d) => d.message.includes("flush-before-exit")),
    ).toEqual([]);
  });
  it("reports when jev judges the flush covers only the success path", () => {
    expect(byFixture("bad-flush-success-only.ts").map((d) => d.message)).toEqual([
      expect.stringMatching(/not flushed on every exit path.*\(p=0\.92\)/),
    ]);
  });
  it("stays quiet when every exit path flushes or nothing batches", () => {
    expect(byFixture("good-flush.ts")).toEqual([]);
    expect(byFixture("simple-processor.ts")).toEqual([]);
  });
});

describe("span-kind-matches-body", () => {
  it("reports only the span whose declared kind disagrees with a confident choice", () => {
    const found = byFixture("span-kind-mismatch.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(
      "declared CHAIN but the wrapped function behaves like a RETRIEVER",
    );
  });
});

describe("no-session-wrapper / esm-manual-instrumentation", () => {
  it("report their anti-patterns", () => {
    expect(byFixture("session-wrapper.ts").map((d) => d.message)).toEqual([
      expect.stringContaining("[jev:no-session-wrapper]"),
    ]);
    expect(byFixture("esm-import-order.ts").map((d) => d.message)).toEqual([
      expect.stringContaining("[jev:esm-manual-instrumentation]"),
    ]);
  });
});

describe("no-sensitive-span-attributes", () => {
  it("reports the hardcoded key in code and each PII attribute plus bulk input via jev, but not the token count", () => {
    const found = byFixture("pii-attributes.ts").map((d) => d.message);
    expect(found).toHaveLength(4);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /"metadata\.api_key" is a hardcoded 40-character string literal.*not sent to jev/,
        ),
        expect.stringContaining('"metadata.patient_dob" carries personal'),
        expect.stringContaining('"metadata.chief_complaint" carries personal'),
        expect.stringContaining("serialize a whole record"),
      ]),
    );
    expect(found.some((m) => m.includes("token_count"))).toBe(false);
  });
  it("stays quiet on operational attributes and masked whole-record input", () => {
    expect(byFixture("benign-attributes.ts")).toEqual([]);
    expect(byFixture("pii-masked.ts")).toEqual([]);
  });
});

describe("routing and hints", () => {
  it("asks one relevance question per bundled reference with SKILL.md as the index", () => {
    const routing = requests().filter(
      (r) => r.request.state.index && r.filename.endsWith("hint-error-status.ts"),
    )[0];
    expect(routing).toBeDefined();
    const keys = Object.keys(routing!.request.questions);
    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(keys.every((k) => k.startsWith("relevant__"))).toBe(true);
  });
  it("surfaces a hint for relevant guidance no check covers, and not for cited guidance", () => {
    expect(byFixture("hint-error-status.ts").map((d) => d.message)).toEqual([
      expect.stringMatching(
        /\[jev:hint\] phoenix-tracing\/references\/production-typescript\.md applies .* \(p=0\.85\)/,
      ),
    ]);
    const detailed = requests().find(
      (r) => r.filename.endsWith("good-flush.ts") && r.request.state.guidance,
    )!;
    expect((detailed.request.state.guidance as Record<string, unknown>).hints).toBeUndefined();
  });
});

describe("redaction", () => {
  it("never sends string literal values from linted files", () => {
    const bodies = requests().map((r) =>
      JSON.stringify({ code: r.request.state.code, facts: r.request.state.facts }),
    );
    for (const b of bodies) {
      expect(b).not.toContain("sk-live-");
      expect(b).not.toContain("Fatal error");
      expect(b).not.toContain("gpt-4o-mini");
    }
    const pii = requests().find(
      (r) => r.filename.endsWith("pii-attributes.ts") && r.request.state.guidance,
    )!;
    const code = JSON.stringify(pii.request.state.code);
    expect(code).toContain('\\"metadata.api_key\\": \\"<str:40>\\"');
    expect(code).toContain('kind: \\"CHAIN\\"');
    expect(code).toContain("metadata.patient_dob");
  });
  it("keeps every request inside jev's limits", () => {
    for (const r of requests()) {
      const state = JSON.stringify(r.request.state).length / 4;
      const longest = Math.max(
        ...Object.values(r.request.questions).map((q) => JSON.stringify(q).length / 4),
      );
      expect(state + longest).toBeLessThan(32_000);
    }
  });
});
