#!/usr/bin/env node
/**
 * jev-lint — authoring tools for a jev-oxlint linter.
 *
 *   jev-lint survey    --plugin <dist/index.js> [--threshold 0.7] <paths...>
 *   jev-lint calibrate --plugin <dist/index.js> --key <answer-key.json> <fixtures...>
 *   jev-lint propose   --plugin <dist/index.js> --guidance <references/x.md> <paths...>
 *
 * All three run oxlint with the given plugin in live mode against a private
 * cache directory, then read the recorded requests/responses. `propose` stops
 * at assembling the context packet a generative model (or a person) needs to
 * draft a check; the model call itself is a deliberate seam, not yet wired.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type { AnalysisRecord, AnswerKey } from "@jev-oxlint/engine";
import { calibrate, readRecords, summarizeRouting } from "@jev-oxlint/engine";

interface Args {
  command: string;
  plugin?: string;
  key?: string;
  guidance?: string;
  threshold: number;
  out?: string;
  paths: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: argv[0] ?? "help", threshold: 0.7, paths: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    if (a === "--plugin") args.plugin = next();
    else if (a === "--key") args.key = next();
    else if (a === "--guidance") args.guidance = next();
    else if (a === "--threshold") args.threshold = Number(next());
    else if (a === "--out") args.out = next();
    else args.paths.push(a);
  }
  return args;
}

function oxlintBin(): string {
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve("oxlint/package.json"));
  const { bin } = require("oxlint/package.json") as { bin: Record<string, string> };
  return path.join(pkgDir, bin.oxlint ?? "bin/oxlint");
}

/** Run oxlint with a throwaway config that loads only the given plugin; return the records. */
function runPlugin(plugin: string, paths: string[], mode: "live" | "mock"): AnalysisRecord[] {
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), "jev-lint-"));
  const configDir = mkdtempSync(path.join(os.tmpdir(), "jev-lint-cfg-"));
  const specifier = path.resolve(plugin);
  const config = {
    jsPlugins: [{ name: "lint", specifier }],
    rules: { "lint/guidance": "warn" },
    ignorePatterns: ["**/node_modules/**", "**/dist/**"],
  };
  const configPath = path.join(configDir, ".oxlintrc.json");
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(oxlintBin(), ["-c", configPath, ...paths.map((p) => path.resolve(p))], {
    encoding: "utf8",
    env: {
      ...process.env,
      OXLINT_JEV_MODE: mode,
      OXLINT_JEV_CACHE_DIR: cacheDir,
      OXLINT_JEV_QUIET: "1",
    },
  });
  if (result.error) throw result.error;
  process.stderr.write(result.stderr);
  return readRecords(cacheDir);
}

function usage(records: AnalysisRecord[]): string {
  const tokens = records.reduce((n, r) => n + (r.response?.usage?.input_tokens ?? 0), 0);
  return `${records.length} requests, ${tokens.toLocaleString()} input tokens ≈ $${((tokens * 0.042) / 1e6).toFixed(4)}`;
}

function survey(args: Args): number {
  if (!args.plugin) return fail("survey needs --plugin <path to built plugin>");
  const records = runPlugin(args.plugin, args.paths, "live");
  const files = new Set(records.map((r) => r.filename)).size;
  const rows = summarizeRouting(records, args.threshold);
  console.log(`\nSurveyed ${files} in-scope file(s). Guidance relevance (≥ ${args.threshold}):\n`);
  console.log("  files  mean   reference");
  for (const row of rows)
    console.log(
      `  ${String(row.relevantFiles.length).padStart(5)}  ${row.meanRelevance.toFixed(2)}   ${row.reference}`,
    );
  console.log(
    `\nThe rows with many files and no check are what to write (or propose) next.\n${usage(records)}`,
  );
  return 0;
}

function calibrateCmd(args: Args): number {
  if (!args.plugin || !args.key)
    return fail("calibrate needs --plugin and --key <answer-key.json>");
  const key = JSON.parse(readFileSync(args.key, "utf8")) as AnswerKey;
  const records = runPlugin(args.plugin, args.paths, "live");
  const rows = calibrate(records, key);
  const failed = rows.filter((r) => !r.ok);
  console.log(
    `\n${rows.length} answers compared against ${path.basename(args.key)}; ${failed.length} outside tolerance.\n`,
  );
  const w = Math.max(...rows.map((r) => r.file.length + r.question.length + 3));
  for (const r of rows)
    console.log(
      `  ${r.ok ? "ok  " : "MISS"} ${`${r.file} › ${r.question}`.padEnd(w)}  expected ${r.expected}  got ${r.actual}`,
    );
  if (args.out) {
    const md = [
      "# Calibration",
      "",
      `Model answers vs \`${path.basename(args.key)}\`. ${failed.length} of ${rows.length} outside tolerance.`,
      "",
      "| | file | question | expected | actual |",
      "|---|---|---|---|---|",
      ...rows.map(
        (r) => `| ${r.ok ? "✓" : "✗"} | ${r.file} | ${r.question} | ${r.expected} | ${r.actual} |`,
      ),
      "",
      usage(records),
    ].join("\n");
    writeFileSync(args.out, md);
    console.log(`\nwrote ${args.out}`);
  }
  console.log(`\n${usage(records)}`);
  return failed.length > 0 ? 1 : 0;
}

/**
 * Assemble everything a proposer needs to draft a check for one guidance
 * file: the guidance text, which surveyed files it applies to (with their
 * redacted code and extracted calls, taken from the recorded requests), and
 * the engine's check contract. Written as a single markdown packet.
 */
function propose(args: Args): number {
  if (!args.plugin || !args.guidance)
    return fail("propose needs --plugin and --guidance <skill>/references/<file>.md");
  const records = runPlugin(args.plugin, args.paths, "live");
  const stem = path.basename(args.guidance, ".md");
  const relevant = records.filter(
    (r) =>
      r.kind === "routing" &&
      (r.response?.answers[`relevant__${stem}`] as { noul?: number } | undefined)?.noul !==
        undefined &&
      ((r.response!.answers[`relevant__${stem}`] as { noul: number }).noul ?? 0) >= args.threshold,
  );
  const guidanceText = readFileSync(args.guidance, "utf8");
  const samples = relevant.slice(0, 5).map((r) => {
    const detailed = records.find((d) => d.kind === "detailed" && d.filename === r.filename);
    const code = (r.request.state as { code: { text: string } }).code.text;
    const calls = detailed
      ? JSON.stringify((detailed.request.state as { code: { calls: unknown } }).code.calls, null, 2)
      : "[]";
    return `### ${path.relative(process.cwd(), r.filename)} (relevance ${(r.response!.answers[`relevant__${stem}`] as { noul: number }).noul.toFixed(2)})\n\n\`\`\`ts\n${code}\n\`\`\`\n\nExtracted calls:\n\n\`\`\`json\n${calls}\n\`\`\``;
  });
  const packet = [
    `# Proposal context: ${args.guidance}`,
    "",
    `Routing found this guidance relevant (≥ ${args.threshold}) to ${relevant.length} of ${new Set(records.map((r) => r.filename)).size} surveyed file(s). No existing check cites it.`,
    "",
    "## Task for the proposer",
    "",
    "Draft ONE check in the `@jev-oxlint/engine` `Check` shape (see contract below): a deterministic `appliesTo`/`precheck` using the generic facts, one or more narrow Noul/Choice questions that point into `code.calls[i]` and `guidance.<stateKey>`, and a `decide`. Also draft three fixtures (a violation, a correct version, and a trap a naive rule would get wrong) and answer-key entries. Put the questions and thresholds first; they are what a reviewer must read.",
    "",
    "## Guidance",
    "",
    guidanceText.trim(),
    "",
    "## Sample in-scope files (redacted exactly as jev sees them)",
    "",
    ...samples,
    "",
    "## Check contract",
    "",
    "```ts",
    readFileSync(new URL("../../engine/src/check.ts", import.meta.url), "utf8").trim(),
    "```",
    "",
    usage(records),
  ].join("\n");
  const out = args.out ?? path.join("proposals", `${stem}.md`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, packet);
  console.log(
    `wrote ${out} (${relevant.length} relevant file(s), ${samples.length} sample(s)). Hand it to a generative model or a person to draft the check.`,
  );
  return 0;
}

function fail(msg: string): number {
  console.error(`jev-lint: ${msg}`);
  return 2;
}

const args = parseArgs(process.argv.slice(2));
const commands: Record<string, (a: Args) => number> = { survey, calibrate: calibrateCmd, propose };
const run = commands[args.command];
if (!run) {
  console.log(
    "usage: jev-lint <survey|calibrate|propose> --plugin <dist/index.js> [--key answer-key.json] [--guidance <file.md>] [--threshold 0.7] [--out <file>] <paths...>",
  );
  process.exit(args.command === "help" ? 0 : 2);
}
process.exit(run(args));
