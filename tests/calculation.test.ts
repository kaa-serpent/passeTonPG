import assert from "node:assert/strict";
import test from "node:test";
import { calculate, rankKeys } from "../src/lib/calculation";
import type { Entry, Position, Project } from "../src/lib/types";

const entry = (id: string, positions: Position[], type: Entry["type"] = "cylinder"): Entry => ({
  id, type, name: id, description: "", positions,
});
const project = (entries: Entry[], overrides: Partial<Project> = {}): Project => ({
  id: "project", name: "Test", description: "", pinCount: 5, min: 0, max: 9, macs: null,
  cylinderType: null, modelId: null, modelVersion: null, entries, revision: 1, updatedAt: "2026-10-27T00:00:00Z", ...overrides,
});
const positions = (code: string): Position[] => [...code].map(Number).map((value) => [value]);
const unknown = (count = 5): Position[] => Array.from({ length: count }, () => null);

test("waits for two cylinders and does not count known keys as constraints", () => {
  const one = entry("c1", positions("01234"));
  assert.equal(calculate(project([one])).ready, false);
  assert.equal(calculate(project([one, entry("key", positions("98765"), "key")])).ready, false);
  const result = calculate(project([one, entry("c2", positions("01234")), entry("key", positions("98765"), "key")]));
  assert.equal(result.ready, true);
  assert.deepEqual(result.codes, ["01234"]);
});

test("intersects positions, deduplicates and orders values, and preserves leading zeroes", () => {
  const result = calculate(project([
    entry("a", [[2, 0, 0, 1], [3, 2], [4], [5, 6], [0]]),
    entry("b", [[0, 2], [2], [4, 8], [6], [0]]),
  ]));
  assert.deepEqual(result.common, [[0, 2], [2], [4], [6], [0]]);
  assert.deepEqual(result.codes, ["02460", "22460"]);
  assert.equal(result.total, 2);
  assert.equal(result.provisional, false);
});

test("unknown positions expand to the project range and mark the result provisional", () => {
  const result = calculate(project([entry("a", unknown()), entry("b", positions("22222"))], { min: 1, max: 3 }));
  assert.deepEqual(result.codes, ["22222"]);
  assert.equal(result.provisional, true);
});

test("supports six positions and exactly counts one million codes without generating them all", () => {
  const result = calculate(project([entry("a", unknown(6)), entry("b", unknown(6))], { pinCount: 6 }), 999_950);
  assert.equal(result.total, 1_000_000);
  assert.equal(result.codes.length, 50);
  assert.equal(result.codes[0], "999950");
  assert.equal(result.codes[49], "999999");
});

test("counts and pages 100 billion codes for eleven discs and ranks all positions", () => {
  const sample = project([
    entry("a", unknown(11)), entry("b", unknown(11)),
    entry("key", positions("00000000001"), "key"),
  ], { cylinderType: "disque", pinCount: 11 });
  const result = calculate(sample, 99_999_999_950);
  assert.equal(result.total, 100_000_000_000);
  assert.equal(result.codes.length, 50);
  assert.equal(result.codes[0], "99999999950");
  assert.equal(result.codes[49], "99999999999");
  assert.deepEqual(calculate(sample, 0, 1).codes, ["00000000000"]);
  sample.entries[0].positions = positions("00000000000");
  sample.entries[1].positions = positions("00000000001");
  const [ranking] = rankKeys(sample);
  assert.equal(ranking.confirmed, 1);
  assert.equal(ranking.incompatible, 1);
  assert.throws(() => calculate({ ...sample, cylinderType: "radial" }), /goupilles/);
});

test("MACS boundary is inclusive and zero is a real constraint", () => {
  const entries = [entry("a", unknown()), entry("b", unknown())];
  assert.deepEqual(calculate(project(entries, { macs: 0 }), 0, 50).codes,
    Array.from({ length: 10 }, (_, digit) => String(digit).repeat(5)));
  assert.deepEqual(calculate(project([entry("a", positions("25252")), entry("b", positions("25252"))], { macs: 3 })).codes, ["25252"]);
  assert.equal(calculate(project([entry("a", positions("26262")), entry("b", positions("26262"))], { macs: 3 })).total, 0);
});

test("distinguishes empty positional intersections from a MACS-only impossibility", () => {
  const empty = calculate(project([entry("a", positions("12345")), entry("b", positions("12346"))]));
  assert.deepEqual(empty.emptyPositions, [5]);
  assert.equal(empty.macsBlocked, false);
  const blocked = calculate(project([entry("a", positions("09090")), entry("b", positions("09090"))], { macs: 2 }));
  assert.deepEqual(blocked.emptyPositions, []);
  assert.equal(blocked.macsBlocked, true);
});

test("pages have no duplicates or omissions and handle offsets beyond the end", () => {
  const sample = project([entry("a", unknown()), entry("b", unknown())], { min: 0, max: 2, macs: 1 });
  const all = calculate(sample, 0, 1_000);
  const pages: string[] = [];
  for (let offset = 0; offset < all.total; offset += 7) pages.push(...calculate(sample, offset, 7).codes);
  assert.deepEqual(pages, all.codes);
  assert.equal(new Set(pages).size, all.total);
  assert.deepEqual(calculate(sample, all.total).codes, []);
  assert.deepEqual(calculate(sample, 0, 0).codes, []);
});

test("exact DP counts and page enumeration agree with an independent brute force reference", () => {
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const count = iteration % 2 ? 5 : 6;
    const sets = () => Array.from({ length: count }, () => random() < 0.3 ? null : [0, 1, 2].filter(() => random() < 0.7));
    const sample = project([entry("a", sets()), entry("b", sets())], { max: 2, pinCount: count, macs: iteration % 3 === 0 ? null : iteration % 2 });
    const expected: string[] = [];
    for (let encoded = 0; encoded < 3 ** count; encoded += 1) {
      const digits = encoded.toString(3).padStart(count, "0").split("").map(Number);
      if (!sample.entries.every((cylinder) => digits.every((digit, index) => cylinder.positions[index] == null || cylinder.positions[index]!.includes(digit)))) continue;
      if (sample.macs !== null && digits.some((digit, index) => index > 0 && Math.abs(digit - digits[index - 1]) > sample.macs!)) continue;
      expected.push(digits.join(""));
    }
    const actual = calculate(sample, 1, 13);
    assert.equal(actual.total, expected.length, `Count in sample ${iteration}`);
    assert.deepEqual(actual.codes, expected.slice(1, 14), `Page in sample ${iteration}`);
  }
});

test("key compatibility gives a known mismatch precedence over unknown positions", () => {
  const sample = project([
    entry("key", positions("12345"), "key"),
    entry("confirmed", [[1, 2], [2], [3], [4], [5]]),
    entry("possible", [null, [2], [3], [4], [5]]),
    entry("incompatible", [null, [2], [3], [4], [6]]),
  ]);
  const [rank] = rankKeys(sample);
  assert.equal(rank.confirmed, 1);
  assert.equal(rank.possible, 1);
  assert.equal(rank.incompatible, 1);
  assert.deepEqual(rank.cylinders.map((match) => match.status), ["compatible", "unknown", "incompatible"]);
});

test("ranks confirmed openings before possible ones and keeps stable order on ties", () => {
  const sample = project([
    entry("first", positions("11111"), "key"),
    entry("best", positions("22222"), "key"),
    entry("tie", positions("11111"), "key"),
    entry("certain", positions("22222")),
    entry("uncertain", [null, [1, 2], [1, 2], [1, 2], [1, 2]]),
  ]);
  assert.deepEqual(rankKeys(sample).map((rank) => rank.entry.id), ["best", "first", "tie"]);
});

test("MACS warnings do not discard a known key or hide its matches", () => {
  const [rank] = rankKeys(project([
    entry("key", positions("09090"), "key"),
    entry("cylinder", positions("09090")),
  ], { macs: 2 }));
  assert.equal(rank.macsValid, false);
  assert.equal(rank.confirmed, 1);
});

test("analyzes non-PG keys even when there is no common master key", () => {
  const sample = project([
    entry("a", positions("11111")), entry("b", positions("22222")),
    entry("local", positions("11111"), "key"),
    entry("other", positions("33333"), "key"),
  ]);
  assert.equal(calculate(sample).total, 0);
  const [local, other] = rankKeys(sample);
  assert.equal(local.pgStatus, "excluded");
  assert.equal(local.confirmed, 1);
  assert.equal(local.incompatible, 1);
  assert.equal(other.pgStatus, "excluded");
  assert.equal(other.incompatible, 2);
});

test("distinguishes supported, possible and undetermined PG status", () => {
  const key = entry("key", positions("11111"), "key");
  const cylinder = entry("a", positions("11111"));
  assert.equal(rankKeys(project([key]))[0].pgStatus, "insufficient");
  assert.equal(rankKeys(project([key, cylinder]))[0].pgStatus, "insufficient");
  assert.equal(rankKeys(project([key, cylinder, entry("b", unknown())]))[0].pgStatus, "possible");
  assert.equal(rankKeys(project([key, cylinder, entry("b", positions("11111"))]))[0].pgStatus, "compatible");
  assert.equal(rankKeys(project([key, entry("b", positions("22222"))]))[0].pgStatus, "excluded");
  const warning = rankKeys(project([
    entry("key", positions("09090"), "key"),
    entry("a", positions("09090")), entry("b", positions("09090")),
  ], { macs: 2 }))[0];
  assert.equal(warning.macsValid, false);
  assert.equal(warning.pgStatus, "compatible");
});

test("malformed settings fail safely instead of producing invalid candidates", () => {
  assert.throws(() => calculate(project([], { min: 4, max: 2 })), /plage/);
  assert.throws(() => calculate(project([], { macs: -1 })), /MACS/);
  assert.throws(() => rankKeys(project([], { max: 10 })), /plage/);
});


test("disc cylinders ignore stale MACS for candidates, pagination and key ranking", () => {
  const sample = project([
    entry("a", unknown()), entry("b", unknown()), entry("key", positions("09090"), "key"),
  ], { cylinderType: "disque", macs: 0 });
  const result = calculate(sample, 90_900, 3);
  assert.equal(result.total, 100_000);
  assert.deepEqual(result.codes, ["90900", "90901", "90902"]);
  assert.equal(result.macsBlocked, false);
  assert.equal(rankKeys(sample)[0].macsValid, true);
  const known = project([entry("a", positions("09090")), entry("b", positions("09090"))], { cylinderType: "disque", macs: 1 });
  assert.deepEqual(calculate(known).codes, ["09090"]);
  assert.equal(calculate({ ...sample, cylinderType: "radial" }).total, 10);
  assert.equal(rankKeys({ ...sample, cylinderType: "radial" })[0].macsValid, false);
});
