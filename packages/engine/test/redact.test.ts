import { describe, expect, it } from "vitest";

import { sliceSection } from "./_noop.js";
import { Redactor } from "../src/redact.js";
import type { SourceCode } from "../src/oxlintTypes.js";

// A tiny ESTree fixture: `const o = { "k.e": "secret", n: 4111111111111111, kind: "CHAIN" };`
function fakeSource(text: string, ast: unknown): SourceCode {
  return {
    text,
    ast: ast as SourceCode["ast"],
    getText: (n) =>
      n
        ? text.slice(
            (n as { range: [number, number] }).range[0],
            (n as { range: [number, number] }).range[1],
          )
        : text,
    getAncestors: () => [],
  };
}

describe("Redactor", () => {
  it("redacts string values but keeps keys and kind/name/type option values", () => {
    const text = 'const o = { "k.e": "secret", n: 4111111111111111, kind: "CHAIN" };';
    const lit = (start: number, end: number, value: unknown, raw?: string) => ({
      type: "Literal",
      value,
      raw,
      range: [start, end],
    });
    const key1 = lit(12, 17, "k.e");
    const val1 = lit(19, 27, "secret");
    const keyN = { type: "Identifier", name: "n", range: [29, 30] };
    const valN = lit(32, 48, 4111111111111111, "4111111111111111");
    const keyK = { type: "Identifier", name: "kind", range: [50, 54] };
    const valK = lit(56, 63, "CHAIN");
    const props = [
      { type: "Property", key: key1, value: val1, computed: false },
      { type: "Property", key: keyN, value: valN, computed: false },
      { type: "Property", key: keyK, value: valK, computed: false },
    ];
    const ast = {
      type: "Program",
      body: [
        {
          type: "VariableDeclaration",
          declarations: [
            {
              type: "VariableDeclarator",
              id: { type: "Identifier", name: "o" },
              init: { type: "ObjectExpression", properties: props },
            },
          ],
        },
      ],
    };
    const r = new Redactor(fakeSource(text, ast), "all");
    expect(r.text()).toBe('const o = { "k.e": "<str:6>", n: <num:16>, kind: "CHAIN" };');
    expect(r.redactions).toBe(2);
  });

  it("is a no-op when policy is off", () => {
    const text = 'const s = "x";';
    const r = new Redactor(fakeSource(text, { type: "Program", body: [] }), "off");
    expect(r.text()).toBe(text);
  });

  it("has no section slicing anywhere", () => {
    expect(sliceSection).toBeUndefined();
  });
});
