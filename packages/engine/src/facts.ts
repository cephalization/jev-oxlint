/**
 * Generic, deterministic fact extraction from the AST, driven by
 * `FactsConfig`. Checks consume these facts; nothing here knows about any
 * particular SDK. Everything textual goes through the redactor.
 */
import type * as ESTree from "estree";

import type { FactsConfig } from "./config.js";
import type { RuleContext } from "./oxlintTypes.js";
import type { Redactor } from "./redact.js";

export interface ImportFact {
  source: string;
  /** "default" | "*" | named import | "*side-effect*" */
  imported: string;
  local: string;
  line: number;
}

export interface ObjectEntry {
  key: string;
  /** Redacted source of the value. */
  valueText: string;
  valueKind: "literal" | "expression" | "object" | "function";
  /** Booleans and short numbers only; strings are never carried, see `literalLength`. */
  literalValue?: boolean | number | null;
  /** Length of a string literal value (its content is redacted). */
  literalLength?: number;
  /** One level of nesting for object values (e.g. `attributes: { ... }`). */
  entries?: ObjectEntry[];
  line: number;
}

export interface ArgFact {
  index: number;
  kind: "object" | "literal" | "expression" | "function";
  text: string;
  entries?: ObjectEntry[];
}

export interface CallFact {
  /** Imported (not local) name, e.g. `register`, `withSpan`. */
  name: string;
  source: string;
  node: ESTree.CallExpression;
  line: number;
  callText: string;
  /** Redacted text of the enclosing top-level statement (capped). */
  statementText: string;
  args: ArgFact[];
  /** Variable the result is assigned to, if any. */
  assignedTo?: string;
}

export interface Facts {
  filename: string;
  fileText: string;
  imports: ImportFact[];
  contextImports: string[];
  calls: CallFact[];
  memberCalls: Array<{ method: string; text: string; line: number }>;
  processHandlers: Array<{ event: string; line: number }>;
  exportedNames: string[];
  flags: Record<string, boolean>;
}

const MAX_STATEMENT_CHARS = 4_000;
const SHORT_NUMBER_DIGITS = 7;

const lineOf = (node: ESTree.Node): number => node.loc?.start.line ?? 0;

export function literalString(node: ESTree.Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? "").join("");
  }
  return undefined;
}

function propertyKey(prop: ESTree.Property): string | undefined {
  if (prop.key.type === "Identifier" && !prop.computed) return prop.key.name;
  return literalString(prop.key);
}

function isFunction(node: ESTree.Node): boolean {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

function objectEntries(
  obj: ESTree.ObjectExpression,
  redactor: Redactor,
  depth: number,
): ObjectEntry[] {
  const out: ObjectEntry[] = [];
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const key = propertyKey(prop);
    if (key === undefined) continue;
    const value = prop.value as ESTree.Node;
    const entry: ObjectEntry = {
      key,
      valueText: redactor.textOf(value),
      valueKind: "expression",
      line: lineOf(prop),
    };
    const str = literalString(value);
    if (str !== undefined) {
      entry.valueKind = "literal";
      entry.literalLength = str.length;
    } else if (value.type === "Literal") {
      entry.valueKind = "literal";
      const v = value.value;
      if (typeof v === "boolean" || v === null) entry.literalValue = v;
      else if (typeof v === "number" && String(v).replace(/\D/g, "").length < SHORT_NUMBER_DIGITS)
        entry.literalValue = v;
    } else if (value.type === "ObjectExpression") {
      entry.valueKind = "object";
      if (depth > 0) entry.entries = objectEntries(value, redactor, depth - 1);
    } else if (isFunction(value)) {
      entry.valueKind = "function";
    }
    out.push(entry);
  }
  return out;
}

function describeArgs(call: ESTree.CallExpression, redactor: Redactor): ArgFact[] {
  return call.arguments.map((arg, index) => {
    const node = arg as ESTree.Node;
    const text = redactor.textOf(node);
    if (node.type === "ObjectExpression") {
      return { index, kind: "object", text, entries: objectEntries(node, redactor, 1) };
    }
    if (node.type === "Literal" || node.type === "TemplateLiteral")
      return { index, kind: "literal", text };
    if (isFunction(node)) return { index, kind: "function", text };
    return { index, kind: "expression", text };
  });
}

export function createFactCollector(context: RuleContext, config: FactsConfig, redactor: Redactor) {
  const { sourceCode } = context;
  const bindings = new Map<string, { source: string; imported: string }>();
  const track = new Set(config.trackMemberCalls ?? []);
  const flagProps = new Set(config.flagProperties ?? []);
  const facts: Facts = {
    filename: context.filename,
    fileText: sourceCode.text,
    imports: [],
    contextImports: [],
    calls: [],
    memberCalls: [],
    processHandlers: [],
    exportedNames: [],
    flags: {},
  };
  for (const [name, pattern] of Object.entries(config.flagTextPatterns ?? {})) {
    if (pattern.test(sourceCode.text)) facts.flags[name] = true;
  }

  function statementText(node: ESTree.Node): string {
    const ancestors = sourceCode.getAncestors(node);
    const statement = ancestors[1] ?? node;
    const text = redactor.textOf(statement);
    return text.length > MAX_STATEMENT_CHARS ? redactor.textOf(node) : text;
  }

  function resolveCallee(
    callee: ESTree.Expression | ESTree.Super,
  ): { name: string; source: string } | undefined {
    if (callee.type === "Identifier") {
      const b = bindings.get(callee.name);
      return b
        ? { name: b.imported === "default" ? callee.name : b.imported, source: b.source }
        : undefined;
    }
    if (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.object.type === "Identifier"
    ) {
      const b = bindings.get(callee.object.name);
      if (b && b.imported === "*" && callee.property.type === "Identifier") {
        return { name: callee.property.name, source: b.source };
      }
    }
    return undefined;
  }

  const visitor = {
    ImportDeclaration(node: ESTree.ImportDeclaration) {
      const source = String(node.source.value);
      const isTarget = config.targets.test(source);
      if (config.contextImports?.test(source)) facts.contextImports.push(source);
      if (!isTarget) return;
      if (node.specifiers.length === 0) {
        facts.imports.push({ source, imported: "*side-effect*", local: "", line: lineOf(node) });
      }
      for (const spec of node.specifiers) {
        let imported: string;
        if (spec.type === "ImportDefaultSpecifier") imported = "default";
        else if (spec.type === "ImportNamespaceSpecifier") imported = "*";
        else
          imported =
            spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value);
        facts.imports.push({ source, imported, local: spec.local.name, line: lineOf(node) });
        bindings.set(spec.local.name, { source, imported });
      }
    },

    CallExpression(node: ESTree.CallExpression) {
      const callee = node.callee;
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier"
      ) {
        const method = callee.property.name;
        if (track.has(method))
          facts.memberCalls.push({ method, text: redactor.textOf(node), line: lineOf(node) });
        if (
          config.trackProcessEvents &&
          method === "on" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "process"
        ) {
          const event = literalString(node.arguments[0] as ESTree.Node);
          if (event) facts.processHandlers.push({ event, line: lineOf(node) });
        }
      }
      const resolved = resolveCallee(callee);
      if (!resolved) return;
      const ancestors = sourceCode.getAncestors(node);
      const parent = ancestors[ancestors.length - 1];
      facts.calls.push({
        name: resolved.name,
        source: resolved.source,
        node,
        line: lineOf(node),
        callText: redactor.textOf(node),
        statementText: statementText(node),
        args: describeArgs(node, redactor),
        assignedTo:
          parent?.type === "VariableDeclarator" && parent.id.type === "Identifier"
            ? parent.id.name
            : undefined,
      });
    },

    Property(node: ESTree.Property) {
      const key = propertyKey(node);
      if (key && flagProps.has(key) && node.value.type === "Literal" && node.value.value === true) {
        facts.flags[key] = true;
      }
    },

    ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
      for (const spec of node.specifiers) {
        if (spec.local.type === "Identifier") facts.exportedNames.push(spec.local.name);
      }
      const decl = node.declaration;
      if (decl?.type === "VariableDeclaration") {
        for (const d of decl.declarations)
          if (d.id.type === "Identifier") facts.exportedNames.push(d.id.name);
      } else if (decl && "id" in decl && decl.id?.type === "Identifier") {
        facts.exportedNames.push(decl.id.name);
      }
    },
  };

  return { visitor, finish: () => facts };
}

export const inScope = (facts: Facts): boolean => facts.imports.length > 0;
