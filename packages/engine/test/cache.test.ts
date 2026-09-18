import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { requestHash, ResponseCache } from "../src/cache.js";

describe("ResponseCache", () => {
  it("hashes the whole request and round-trips responses", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jev-cache-"));
    const cache = new ResponseCache(dir);
    const req = { model: "jev-latest", state: { a: 1 }, questions: {} };
    const h1 = requestHash(req);
    expect(requestHash({ ...req, state: { a: 2 } })).not.toBe(h1);
    expect(cache.get(h1)).toBeUndefined();
    cache.set(h1, { model: "m", answers: {} });
    expect(cache.get(h1)).toEqual({ model: "m", answers: {} });
    const file = cache.record(h1, "/x/y.ts", req);
    expect(file.endsWith(`${h1}.json`)).toBe(true);
  });
});
