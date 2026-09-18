#!/usr/bin/env node
/**
 * jev-lint — authoring tools for a jev-oxlint linter.
 *
 *   jev-lint survey    --plugin <dist/index.js> [--threshold 0.7] <paths...>
 *   jev-lint calibrate --plugin <dist/index.js> --key <answer-key.json> <fixtures...>
 *   jev-lint propose   --plugin <dist/index.js> --guidance <references/x.md> [--linter <dir>]
 *                      [--dry-run] [--model claude-opus-5] [--effort high] [--calibrate] <paths...>
 *
 * All three run oxlint with the given plugin in live mode against a private
 * cache directory, then read the recorded requests/responses. `propose`
 * additionally asks Claude to draft one check from the assembled packet and
 * writes the check, fixtures, answer-key entries and a review note into the
 * linter package (`--dry-run` writes only the packet).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type { AnalysisRecord, AnswerKey, LinterConfig } from "@jev-oxlint/engine";
import { calibrate, readRecords, summarizeRouting } from "@jev-oxlint/engine";

import { applyProposal } from "./apply.js";
import type { LinterInfo } from "./packet.js";
import { buildPacket } from "./packet.js";
import type { ProposeOptions } from "./propose.js";
import { DEFAULT_MODEL, proposeWithClaude } from "./propose.js";

interface Args {
  command: string;
  plugin?: string;
  key?: string;
  guidance?: string;
  linter?: string;
  threshold: number;
  out?: string;
  dryRun: boolean;
  model: string;
  effort?: ProposeOptions["effort"];
  runCalibrate: boolean;
  paths: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] ?? "help",
    threshold: 0.7,
    paths: [],
    dryRun: false,
    model: DEFAULT_MODEL,
    runCalibrate: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    if (a === "--plugin") args.plugin = next();
    else if (a === "--key") args.key = next();
    else if (a === "--guidance") args.guidance = next();
    else if (a === "--threshold") args.threshold = Number(next());
    else if (a === "--out") args.out = next();
    else if (a === "--linter") args.linter = next();
    else if (a === "--model") args.model = next() ?? DEFAULT_MODEL;
    else if (a === "--effort") args.effort = next() as ProposeOptions["effort"];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--calibrate") args.runCalibrate = true;
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

/** The linter package directory: --linter, else the nearest package.json above the plugin file. */
function linterDirOf(args: Args): string {
  if (args.linter) return path.resolve(args.linter);
  let dir = path.dirname(path.resolve(args.plugin!));
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(path.resolve(args.plugin!));
    dir = parent;
  }
}

/** Read what the packet needs from the built plugin module (`export { linter }`) and its skills dir. */
async function linterInfo(plugin: string, linterDir: string): Promise<LinterInfo> {
  const info: LinterInfo = { references: [] };
  try {
    const mod = (await import(path.resolve(plugin))) as { linter?: LinterConfig };
    const cfg = mod.linter;
    if (cfg) {
      info.name = cfg.name;
      info.skill = cfg.skills.skill;
      info.targets = cfg.facts.targets.source;
      const refs = path.join(
        path.resolve(cfg.packageRoot, cfg.skills.dir),
        cfg.skills.skill,
        "references",
      );
      if (existsSync(refs))
        info.references = readdirSync(refs)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((f) => `references/${f}`);
    }
  } catch {
    /* plugin without a `linter` export: proceed with less context */
  }
  if (info.references.length === 0) {
    const skills = path.join(linterDir, "skills");
    if (existsSync(skills)) {
      for (const skill of readdirSync(skills)) {
        const refs = path.join(skills, skill, "references");
        if (existsSync(refs))
          info.references.push(
            ...readdirSync(refs)
              .filter((f) => f.endsWith(".md"))
              .sort()
              .map((f) => `references/${f}`),
          );
      }
    }
  }
  return info;
}

async function propose(args: Args): Promise<number> {
  if (!args.plugin || !args.guidance)
    return fail("propose needs --plugin and --guidance <skill>/references/<file>.md");
  const linterDir = linterDirOf(args);
  const info = await linterInfo(args.plugin, linterDir);
  console.log(
    `surveying ${args.paths.length} path(s) with ${path.relative(process.cwd(), args.plugin)}…`,
  );
  const records = runPlugin(args.plugin, args.paths, "live");
  const packet = buildPacket(records, args.guidance, args.threshold, info);
  console.log(
    `${packet.guidanceFile}: relevant to ${packet.relevantCount} of ${packet.surveyedCount} in-scope file(s). ${usage(records)}`,
  );

  const packetPath = args.out ?? path.join(linterDir, "proposals", `${packet.stem}.packet.md`);
  mkdirSync(path.dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, packet.markdown);
  console.log(`wrote packet ${path.relative(process.cwd(), packetPath)}`);
  if (args.dryRun) {
    console.log(
      "--dry-run: stopping before the model call. Hand the packet to a model or a person to draft the check.",
    );
    return 0;
  }

  const result = await proposeWithClaude(packet.markdown, {
    model: args.model,
    effort: args.effort,
    onStatus: (l) => console.log(l),
  });
  const { proposal } = result;
  console.log(
    `${result.model}: drafted check "${proposal.check.id}" with ${proposal.fixtures.length} fixture(s) and ${proposal.answerKey.length} answer-key entries (${result.usage.input.toLocaleString()} in / ${result.usage.output.toLocaleString()} out tokens)`,
  );

  const applied = applyProposal(linterDir, proposal, packet.markdown, {
    model: result.model,
    guidanceFile: packet.guidanceFile,
  });
  for (const f of applied.written) console.log(`  wrote ${f}`);
  if (!applied.registered)
    console.log(
      `  could not register the check automatically; add \`${proposal.check.exportName}\` to the checks array in src/linter.ts`,
    );
  console.log(
    `\nReview first: proposals/${proposal.check.id}.md (questions and thresholds), then src/checks/${proposal.check.fileName}.`,
  );
  if (proposal.review.factsNeeded.length > 0) {
    console.log(`The draft says it would be better with facts the engine does not extract:`);
    for (const f of proposal.review.factsNeeded) console.log(`  - ${f}`);
  }

  if (!args.runCalibrate) {
    console.log(
      `\nNext: (cd ${path.relative(process.cwd(), linterDir) || "."} && pnpm build && jev-lint calibrate --plugin dist/index.js --key answer-key.json fixtures)`,
    );
    return 0;
  }
  console.log(`\nbuilding ${path.relative(process.cwd(), linterDir) || "."}…`);
  const build = spawnSync("pnpm", ["build"], { cwd: linterDir, encoding: "utf8" });
  if (build.status !== 0) {
    console.error(build.stdout);
    console.error(build.stderr);
    return fail("the drafted check did not compile; fix src/checks and rerun calibrate");
  }
  const keyPath = path.join(linterDir, "answer-key.json");
  return calibrateCmd({
    ...args,
    key: keyPath,
    paths: [path.join(linterDir, "fixtures")],
    out: path.join(linterDir, "proposals", `${proposal.check.id}.calibration.md`),
  });
}

function fail(msg: string): number {
  console.error(`jev-lint: ${msg}`);
  return 2;
}

const args = parseArgs(process.argv.slice(2));
const commands: Record<string, (a: Args) => number | Promise<number>> = {
  survey,
  calibrate: calibrateCmd,
  propose,
};
const run = commands[args.command];
if (!run) {
  console.log(
    [
      "usage:",
      "  jev-lint survey    --plugin <dist/index.js> [--threshold 0.7] <paths...>",
      "  jev-lint calibrate --plugin <dist/index.js> --key <answer-key.json> [--out <report.md>] <fixtures...>",
      "  jev-lint propose   --plugin <dist/index.js> --guidance <skills/<skill>/references/<file>.md>",
      "                     [--linter <dir>] [--dry-run] [--model claude-opus-5] [--effort high] [--calibrate] <paths...>",
      "",
      "Needs TYPESAFE_API_KEY for jev. `propose` (without --dry-run) also needs Anthropic credentials:",
      "ANTHROPIC_API_KEY, or an `ant auth login` profile.",
    ].join("\n"),
  );
  process.exit(args.command === "help" ? 0 : 2);
}
try {
  process.exit(await run(args));
} catch (error) {
  console.error(`jev-lint: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
