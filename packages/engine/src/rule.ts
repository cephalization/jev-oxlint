/**
 * `createPlugin(linter)` — the oxlint JS plugin. Per file:
 *
 *   import scan ──► no target imports? ──► done (free)
 *        ▼
 *   generic fact extraction (redacted) ──► per-check precheck ──► deterministic findings
 *        ▼
 *   routing request (which guidance applies?) ──► hints for uncovered guidance
 *        ▼
 *   one detailed request: state = { file, code, facts, guidance }, questions from checks + hints
 *        │  content-hash cache; worker-thread + Atomics.wait bridge (rules are synchronous)
 *        ▼
 *   decide() ──► context.report() citing guidance files
 */
import path from "node:path";

import { ResponseCache, requestHash, resolveCacheDir } from "./cache.js";
import type { Check, Finding, QuestionSpec } from "./check.js";
import type { LinterConfig, RuleDefaults } from "./config.js";
import { RULE_DEFAULTS } from "./config.js";
import type { CallFact, Facts, ObjectEntry } from "./facts.js";
import { createFactCollector, inScope } from "./facts.js";
import { GuidanceStore, guidanceSource } from "./guidance.js";
import { mockAnswers } from "./jev/mock.js";
import { callJevSync } from "./jev/sync.js";
import type { EntryType, Question, SystemOneRequest, SystemOneResponse } from "./jev/types.js";
import { API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./jev/types.js";
import type { Plugin, Rule, RuleContext } from "./oxlintTypes.js";
import { REDACTION_NOTE, Redactor } from "./redact.js";
import type { Hint, Routable } from "./routing.js";
import {
  buildHintQuestion,
  buildRoutingQuestions,
  buildRoutingState,
  hintKey,
  listRoutable,
  selectHints,
} from "./routing.js";

export type Mode = "live" | "mock" | "record" | "off";

let noticeShown = false;
function notice(message: string): void {
  if (noticeShown || process.env.OXLINT_JEV_QUIET) return;
  noticeShown = true;
  process.stderr.write(`jev-oxlint: ${message}\n`);
}

export function resolveMode(): Mode {
  const requested = (process.env.OXLINT_JEV_MODE ?? "auto").toLowerCase();
  if (requested === "live" || requested === "mock" || requested === "record" || requested === "off")
    return requested;
  if (process.env[API_KEY_ENV]) return "live";
  notice(
    `${API_KEY_ENV} is not set; jev checks are skipped (set OXLINT_JEV_MODE=record to capture requests).`,
  );
  return "off";
}

function parseOptions(raw: unknown, defaults: RuleDefaults): RuleDefaults {
  const o = (raw ?? {}) as Partial<RuleDefaults>;
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
  return {
    threshold: num(o.threshold, defaults.threshold),
    minConfidence: num(o.minConfidence, defaults.minConfidence),
    redact: o.redact === "off" ? "off" : defaults.redact,
    hints: typeof o.hints === "boolean" ? o.hints : defaults.hints,
    routeThreshold: num(o.routeThreshold, defaults.routeThreshold),
    hintThreshold: num(o.hintThreshold, defaults.hintThreshold),
    maxHints: num(o.maxHints, defaults.maxHints),
  };
}

interface Planned {
  check: Check;
  specs: QuestionSpec[];
}

interface Env {
  config: LinterConfig;
  store: GuidanceStore;
  routable: Routable[];
  mode: Mode;
  options: RuleDefaults;
  redactor: Redactor;
  context: RuleContext;
  facts: Facts;
}

function describeCall(c: CallFact, index: number): EntryType {
  const args: EntryType[] = c.args.map((a) => {
    const out: Record<string, EntryType> = { index: a.index, kind: a.kind };
    if (a.entries) out.entries = a.entries.map(describeEntry);
    return out;
  });
  const out: Record<string, EntryType> = {
    index,
    name: c.name,
    source: c.source,
    line: c.line,
    call: c.callText,
    args,
  };
  if (c.assignedTo) out.assigned_to = c.assignedTo;
  return out;
}

function describeEntry(e: ObjectEntry): EntryType {
  const out: Record<string, EntryType> = { key: e.key, kind: e.valueKind };
  if (e.valueKind === "literal") {
    // Booleans/short numbers are kept; string values arrive already redacted
    // by the Redactor (placeholder, or verbatim for structural kind/name/type).
    out.value = e.literalValue !== undefined ? e.literalValue : e.valueText;
  } else if (e.valueKind === "object" && e.entries) {
    out.entries = e.entries.map(describeEntry);
  } else {
    out.value = e.valueText;
  }
  return out;
}

function buildDetailedRequest(env: Env, planned: Planned[], hints: Hint[]): SystemOneRequest {
  const { config, store, context, facts, redactor } = env;
  const guidance: Record<string, EntryType> = {};
  const questions: Record<string, Question> = {};
  for (const { check, specs } of planned) {
    guidance[check.stateKey] = check.guidance.map((ref) => {
      const g = store.load(ref);
      return { source: g.source, text: g.text };
    });
    for (const spec of specs) questions[spec.key] = spec.question;
  }
  if (hints.length > 0) {
    guidance.hints = hints.map((h, i) => {
      questions[hintKey(h.guidance)] = buildHintQuestion(h, i);
      const g = store.load(h.guidance.ref);
      return { index: i, relevance: h.relevance, source: g.source, text: g.text };
    });
  }
  const maxInline = config.maxInlineFileChars ?? 24_000;
  const fileInlined = facts.fileText.length <= maxInline;
  return {
    model: process.env.OXLINT_JEV_MODEL ?? DEFAULT_MODEL,
    state: {
      file: {
        path: path.relative(context.cwd, context.filename),
        language: /\.tsx?$/.test(context.filename) ? "typescript" : "javascript",
      },
      code: {
        redaction: redactor.policy === "off" ? "none" : REDACTION_NOTE,
        text: fileInlined
          ? redactor.text()
          : `<file too large to inline; ${facts.fileText.length} chars>`,
        calls: facts.calls.map((c, i) => describeCall(c, i)),
      },
      facts: {
        imports: facts.imports.map((i) => ({ source: i.source, name: i.imported, line: i.line })),
        contextImports: facts.contextImports,
        memberCalls: facts.memberCalls,
        processHandlers: facts.processHandlers,
        exportedNames: facts.exportedNames,
        flags: facts.flags,
      },
      guidance,
    },
    questions,
  };
}

function buildRoutingRequest(env: Env): SystemOneRequest {
  const { config, store, context, facts, redactor, routable } = env;
  const maxInline = config.maxInlineFileChars ?? 24_000;
  const text =
    facts.fileText.length <= maxInline
      ? redactor.text()
      : `<file too large to inline; ${facts.fileText.length} chars>`;
  return {
    model: process.env.OXLINT_JEV_MODEL ?? DEFAULT_MODEL,
    state: {
      file: { path: path.relative(context.cwd, context.filename) },
      ...buildRoutingState(
        store,
        config.skills.skill,
        text,
        redactor.policy === "off" ? "none" : REDACTION_NOTE,
        facts,
      ),
    },
    questions: buildRoutingQuestions(routable),
  };
}

function resolveAnswers(env: Env, request: SystemOneRequest): SystemOneResponse | undefined {
  const { context, mode } = env;
  const cache = new ResponseCache(resolveCacheDir(context.cwd));
  const hash = requestHash(request);
  const cached = cache.get(hash);
  if (cached) return cached;
  // Always keep a local copy of exactly what was (or would be) sent.
  cache.record(hash, context.filename, request);
  if (mode === "record") return undefined;
  if (mode === "mock") return mockAnswers(request, context.filename);
  const apiKey = process.env[API_KEY_ENV];
  if (!apiKey) {
    context.report({
      messageId: "unavailable",
      data: { reason: `${API_KEY_ENV} is not set` },
      loc: { line: 1, column: 0 },
    });
    return undefined;
  }
  const result = callJevSync(request, {
    url: `${process.env.OXLINT_JEV_BASE_URL ?? DEFAULT_BASE_URL}/v1/systemone`,
    apiKey,
  });
  if (!result.ok) {
    context.report({
      messageId: "unavailable",
      data: { reason: result.error },
      loc: { line: 1, column: 0 },
    });
    return undefined;
  }
  cache.set(hash, result.response);
  return result.response;
}

function report(env: Env, check: Check, finding: Finding, fallback?: CallFact): void {
  const anchor = finding.anchor ?? fallback;
  const data = {
    id: check.id,
    message: finding.message,
    score: finding.score.toFixed(2),
    sources: check.guidance.map(guidanceSource).join(", "),
  };
  if (anchor) env.context.report({ messageId: "finding", data, node: anchor.node });
  else env.context.report({ messageId: "finding", data, loc: { line: 1, column: 0 } });
}

function planChecks(env: Env): { planned: Planned[]; applied: Check[] } {
  const planned: Planned[] = [];
  const applied: Check[] = [];
  for (const check of env.config.checks) {
    const anchors = check.appliesTo(env.facts);
    if (anchors.length === 0) continue;
    applied.push(check);
    let pre = check.precheck?.(env.facts, anchors) ?? "ask";
    if (typeof pre === "object" && "violations" in pre) {
      for (const v of pre.violations) report(env, check, v, anchors[0]);
      pre = pre.then;
    }
    if (pre === "skip") continue;
    if (pre !== "ask") {
      report(env, check, pre.violation, anchors[0]);
      continue;
    }
    const specs = check.questions(env.facts, anchors, { guidance: env.store });
    if (specs.length > 0) planned.push({ check, specs });
  }
  return { planned, applied };
}

function routeHints(env: Env, applied: Check[]): Hint[] {
  const { options } = env;
  if (!options.hints || options.maxHints <= 0 || env.routable.length === 0) return [];
  const routing = resolveAnswers(env, buildRoutingRequest(env));
  if (!routing) return [];
  const cited = new Set(
    applied.flatMap((c) => [...c.guidance, ...(c.covers ?? [])].map(guidanceSource)),
  );
  return selectHints(env.routable, routing, cited, options.routeThreshold, options.maxHints);
}

function reportHints(env: Env, hints: Hint[], response: SystemOneResponse): void {
  for (const hint of hints) {
    const answer = response.answers[hintKey(hint.guidance)];
    if (!answer || answer.type !== "choice") continue;
    const pDeviates = answer.probabilities.deviates ?? 0;
    if (answer.choice !== "deviates" || pDeviates < env.options.hintThreshold) continue;
    env.context.report({
      messageId: "hint",
      data: {
        source: guidanceSource(hint.guidance.ref),
        relevance: hint.relevance.toFixed(2),
        score: pDeviates.toFixed(2),
      },
      loc: { line: env.facts.imports[0]?.line ?? 1, column: 0 },
    });
  }
}

function reportFindings(env: Env, planned: Planned[], response: SystemOneResponse): void {
  for (const { check, specs } of planned) {
    for (const spec of specs) {
      const answer = response.answers[spec.key];
      if (!answer) continue;
      const finding = check.decide(answer, spec, env.options, env.facts);
      if (finding) report(env, check, finding, spec.anchor ?? check.appliesTo(env.facts)[0]);
    }
  }
}

export function createPlugin(config: LinterConfig): Plugin {
  const defaults: RuleDefaults = { ...RULE_DEFAULTS, ...config.defaults };
  let store: GuidanceStore | undefined;
  let routable: Routable[] | undefined;

  const rule: Rule = {
    meta: {
      type: "suggestion",
      docs: {
        description: `Asks jev whether usage follows the guidance in the ${config.skills.skill} skill`,
      },
      schema: [
        {
          type: "object",
          properties: {
            threshold: { type: "number", minimum: 0, maximum: 1 },
            minConfidence: { type: "number", minimum: 0, maximum: 1 },
            redact: { enum: ["all", "off"] },
            hints: { type: "boolean" },
            routeThreshold: { type: "number", minimum: 0, maximum: 1 },
            hintThreshold: { type: "number", minimum: 0, maximum: 1 },
            maxHints: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
      ],
      messages: {
        finding: "[jev:{{id}}] {{message}} (p={{score}}) — guidance: {{sources}}",
        unavailable: "[jev] guidance checks skipped: {{reason}}",
        hint: "[jev:hint] {{source}} applies to this file (relevance {{relevance}}) and the code deviates from it (p={{score}}). No specific check covers this yet; read the guidance.",
      },
    },
    create(context) {
      const mode = resolveMode();
      if (mode === "off") return {};
      store ??= new GuidanceStore(config);
      routable ??= listRoutable(store, config.skills.skill);
      const options = parseOptions(context.options[0], defaults);
      const redactor = new Redactor(context.sourceCode, options.redact);
      const collector = createFactCollector(context, config.facts, redactor);
      return {
        ...collector.visitor,
        "Program:exit"() {
          const facts = collector.finish();
          if (!inScope(facts)) return;
          const env: Env = {
            config,
            store: store!,
            routable: routable!,
            mode,
            options,
            redactor,
            context,
            facts,
          };
          const { planned, applied } = planChecks(env);
          const hints = routeHints(env, applied);
          if (planned.length === 0 && hints.length === 0) return;
          const response = resolveAnswers(env, buildDetailedRequest(env, planned, hints));
          if (!response) return;
          reportHints(env, hints, response);
          reportFindings(env, planned, response);
        },
      };
    },
  };

  return { meta: { name: config.name }, rules: { guidance: rule } };
}
