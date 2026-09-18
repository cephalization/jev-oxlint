/**
 * A linter is a configuration object: where the skills live, which imports
 * put a file in scope, which generic facts to collect, and the checks.
 * `createPlugin(linter)` turns it into an oxlint JS plugin.
 */
import type { Check } from "./check.js";
import type { RedactPolicy } from "./redact.js";

export interface SkillsConfig {
  /** Directory holding `<skill>/SKILL.md` and `<skill>/references/*.md`. Absolute, or relative to `packageRoot`. */
  dir: string;
  /** Skill folder name under `dir`. Its SKILL.md is the routing index. */
  skill: string;
  /** Optional upstream to copy from at build time (see `syncSkills`). */
  source?: { dir: string; include?: RegExp[] };
}

export interface FactsConfig {
  /** Import specifiers that put a file in scope. Nothing else is ever analysed or sent. */
  targets: RegExp;
  /** Other imports worth recording as context (e.g. libraries that need instrumentation). */
  contextImports?: RegExp;
  /** Member-call method names to record wherever they occur, e.g. `shutdown`. */
  trackMemberCalls?: string[];
  /** Record `process.on(<event>)` handlers. */
  trackProcessEvents?: boolean;
  /** Object property names whose literal `true` sets `facts.flags[name]`. */
  flagProperties?: string[];
  /** Text patterns that set `facts.flags[<source>]` when present anywhere in the file. */
  flagTextPatterns?: Record<string, RegExp>;
}

export interface RuleDefaults {
  threshold: number;
  minConfidence: number;
  redact: RedactPolicy;
  hints: boolean;
  routeThreshold: number;
  hintThreshold: number;
  maxHints: number;
}

export const RULE_DEFAULTS: RuleDefaults = {
  threshold: 0.75,
  minConfidence: 0.6,
  redact: "all",
  hints: true,
  routeThreshold: 0.7,
  hintThreshold: 0.8,
  maxHints: 3,
};

export interface LinterConfig {
  /** Plugin name; rule ids become `<name>/guidance`. */
  name: string;
  /** Absolute path of the linter package (use `fileURLToPath(new URL("..", import.meta.url))`). */
  packageRoot: string;
  skills: SkillsConfig;
  facts: FactsConfig;
  checks: readonly Check[];
  defaults?: Partial<RuleDefaults>;
  /** Files longer than this are not inlined into `state.code.text`. Default 24k chars (~6k tokens). */
  maxInlineFileChars?: number;
}

export function defineLinter(config: LinterConfig): LinterConfig {
  return config;
}
