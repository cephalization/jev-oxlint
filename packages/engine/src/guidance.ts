/**
 * Guidance text comes from whole skill files, cited by path. Nothing inside
 * the markdown is parsed or interpreted by code; the only coupling is the
 * file path, which `verifyGuidance` checks at build time.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { LinterConfig } from "./config.js";

export interface GuidanceRef {
  /** Skill folder name, e.g. `phoenix-tracing`. */
  skill: string;
  /** Path inside the skill, e.g. `references/setup-typescript.md`. */
  file: string;
}

export interface LoadedGuidance {
  source: string;
  text: string;
}

export const guidanceSource = (ref: GuidanceRef): string => `${ref.skill}/${ref.file}`;

export class GuidanceStore {
  readonly root: string;
  private readonly cache = new Map<string, string>();

  constructor(config: LinterConfig) {
    const explicit = process.env.OXLINT_JEV_SKILLS_DIR;
    this.root = explicit ?? path.resolve(config.packageRoot, config.skills.dir);
    if (!existsSync(this.root)) {
      throw new Error(`jev-oxlint: skills directory not found at ${this.root}`);
    }
  }

  path(ref: GuidanceRef): string {
    return path.join(this.root, ref.skill, ref.file);
  }

  exists(ref: GuidanceRef): boolean {
    return existsSync(this.path(ref));
  }

  load(ref: GuidanceRef): LoadedGuidance {
    const file = this.path(ref);
    let text = this.cache.get(file);
    if (text === undefined) {
      text = readFileSync(file, "utf8").trim();
      this.cache.set(file, text);
    }
    return { source: guidanceSource(ref), text };
  }

  /** Every `references/*.md` of a skill, from the directory listing. */
  listReferences(skill: string): GuidanceRef[] {
    const dir = path.join(this.root, skill, "references");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({ skill, file: `references/${f}` }));
  }
}
