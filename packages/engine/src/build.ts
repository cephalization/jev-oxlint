/**
 * Build-time helpers for linter packages: copy skill files from an upstream
 * into the package (symlinks do not survive `npm pack`), write a manifest
 * with the source commit, and fail the build if a check cites a missing file.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { LinterConfig } from "./config.js";
import { GuidanceStore, guidanceSource } from "./guidance.js";

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

export function syncSkills(config: LinterConfig): { copied: string[]; sourceCommit: string } {
  const { skills } = config;
  if (!skills.source) throw new Error("syncSkills: config.skills.source is not set");
  const sourceDir = path.resolve(config.packageRoot, skills.source.dir);
  if (!existsSync(sourceDir)) throw new Error(`syncSkills: ${sourceDir} not found`);
  const target = path.join(path.resolve(config.packageRoot, skills.dir), skills.skill);
  const include = skills.source.include ?? [/.*/];
  rmSync(target, { recursive: true, force: true });
  const copied: string[] = [];
  for (const rel of walk(sourceDir)) {
    if (!include.some((p) => p.test(rel))) continue;
    const dest = path.join(target, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(sourceDir, rel), dest);
    copied.push(`${skills.skill}/${rel}`);
  }
  let sourceCommit = "unknown";
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceDir,
      encoding: "utf8",
    }).trim();
  } catch {
    /* not a git checkout */
  }
  writeFileSync(
    path.join(path.dirname(target), "manifest.json"),
    JSON.stringify(
      { sourceDir, sourceCommit, copiedAt: new Date().toISOString(), files: copied.sort() },
      null,
      2,
    ),
  );
  return { copied, sourceCommit };
}

/** Throws if any check cites a guidance file that is not present. */
export function verifyGuidance(config: LinterConfig): { checks: number; files: number } {
  const store = new GuidanceStore(config);
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const check of config.checks) {
    for (const ref of [...check.guidance, ...(check.covers ?? [])]) {
      seen.add(guidanceSource(ref));
      if (!store.exists(ref)) missing.push(`${check.id}: ${guidanceSource(ref)}`);
    }
  }
  if (!store.exists({ skill: config.skills.skill, file: "SKILL.md" }))
    missing.push(`routing index: ${config.skills.skill}/SKILL.md`);
  if (missing.length > 0)
    throw new Error(`jev-oxlint: cited guidance files are missing:\n  ${missing.join("\n  ")}`);
  return { checks: config.checks.length, files: seen.size };
}
