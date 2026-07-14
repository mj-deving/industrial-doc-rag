/**
 * The corpus question set is an instrument, and an instrument gets tested before
 * it is trusted. Each test here pins one way this question set could quietly
 * measure the wrong thing, and each was written to fail against a deliberate
 * mutation of the generator before it was allowed to pass.
 */

import { describe, expect, test } from "bun:test";
import { corpusQuestions, idClass, rdsonClass, type CorpusQuestion } from "../tools/questions-corpus";
import { isHoldout } from "../tools/split";
import { namedParts } from "../packages/doc-rag/src/answer";
import { cleanPackages } from "../src/api/contracts";
import type { GroundTruth } from "../tools/groundtruth";

const labels: GroundTruth[] = await Bun.file("data/groundtruth.json").json();
const questions = corpusQuestions(labels);
const indexed = labels.filter((l) => !isHoldout(l.part));
const byPart = new Map(labels.map((l) => [l.part, l]));

const superlatives = questions.filter((q) => q.kind !== "count");
const rating = (vds: number) => Math.abs(vds);

/** The candidate set a question's filter actually selects, recomputed from the
 *  labels rather than trusted from the question. */
function candidatesOf(q: CorpusQuestion): GroundTruth[] {
  const { channel, vds, conditions, package: pkg } = q.filter as Record<string, string | number>;
  // Through the same normaliser the question generator used. The label copies the PDF's
  // non-breaking hyphen, so a raw `includes` finds 32 of the 48 parts in a DFN2020MD-6
  // and calls the other 16 a different package. "Recomputable from the labels" has to
  // mean recomputable from the labels read the same way, or the check is testing the
  // typography of a hyphen.
  if (pkg !== undefined)
    return indexed.filter((l) => cleanPackages(l.package ?? []).includes(pkg as string));
  if (channel === undefined) return indexed.filter((l) => l.vds_v !== null && rating(l.vds_v) === vds);

  // EVERY row, not the one row the parser kept. A part whose singular label sits in the
  // VGS = 10 V class still publishes a VGS = 4.5 V row, and it belongs in the 4.5 V
  // comparison — PSMNR58-30YLH is not merely a member of that pool, it WINS it. A check
  // that recomputes the truth from one row per part re-derives the bug it should catch.
  const measure = q.id.startsWith("corpus:id-") ? "id" : "rdson";
  return indexed.filter((l) => {
    if (l.channel !== channel || l.vds_v === null || rating(l.vds_v) !== vds) return false;
    const rows = measure === "id" ? l.id_all : l.rdson_all;
    return rows.some((m) => (measure === "id" ? idClass(m) : rdsonClass(m)) === conditions);
  });
}

/** The figure a part enters a comparison with: its own row in THAT condition class, and
 *  the most conservative one if the datasheet prints the class twice. */
function valueIn(label: GroundTruth, q: CorpusQuestion): number {
  const isId = q.id.startsWith("corpus:id-");
  const rows = (isId ? label.id_all : label.rdson_all).filter(
    (m) => (isId ? idClass(m) : rdsonClass(m)) === q.filter.conditions
  );
  return Math.max(...rows.map((m) => Math.abs(m.value)));
}

describe("the question set is derived, never authored", () => {
  test("it produces questions in all three shapes", () => {
    const kinds = new Set(questions.map((q) => q.kind));
    expect(kinds).toEqual(new Set(["superlative-part", "superlative-value", "count"]));
    expect(questions.length).toBeGreaterThan(50);
  });

  test("every answer is recomputable from the labels alone", () => {
    for (const q of superlatives) {
      const candidates = candidatesOf(q);
      const values = candidates.map((c) => valueIn(c, q));
      const expected = q.id.startsWith("corpus:id-") ? Math.max(...values) : Math.min(...values);
      expect(q.truthValue).toBe(expected);
    }
    for (const q of questions.filter((x) => x.kind === "count")) {
      expect(q.truthValue).toBe(candidatesOf(q).length);
    }
  });
});

describe("a comparison across condition classes is not a comparison", () => {
  // The defect this pins: RDS(on) at VGS = 4.5 V reads higher than the same die at
  // VGS = 10 V, so ranking across gate drives ranks the test bench. ID is worse:
  // Tmb holds the mounting base at 25 C (a heatsink), Tamb is free air.
  test("every candidate in a superlative publishes a row IN the class it competes in", () => {
    // The claim moved with the truth. It used to read the ONE row the parser kept and
    // assert that every candidate's class was identical — which tests the parser's
    // choice, not the comparison. A part now enters a pool because it publishes a row in
    // that pool's class, and this asserts exactly that, over every row it has.
    for (const q of superlatives) {
      const isId = q.id.startsWith("corpus:id-");
      for (const c of candidatesOf(q)) {
        const rows = isId ? c.id_all : c.rdson_all;
        expect(rows.some((m) => (isId ? idClass(m) : rdsonClass(m)) === q.filter.conditions)).toBe(true);
      }
    }
  });

  test("no candidate set mixes a mounting-base rating with an ambient one", () => {
    // Tmb holds the mounting base at 25 C, which is a heatsink. Tamb is free air. The
    // class string carries the distinction, so this now asserts it on the class the pool
    // is keyed by rather than on whichever row a part happened to be labelled with.
    for (const q of superlatives.filter((x) => x.id.startsWith("corpus:id-"))) {
      const conditions = String(q.filter.conditions);
      const reference = /\bTmb\b/.test(conditions) ? "Tmb" : "Tamb-or-other";
      for (const c of candidatesOf(q)) {
        const rows = c.id_all.filter((m) => idClass(m) === conditions);
        for (const m of rows) {
          expect(/\bTmb\b/.test(m.conditions) ? "Tmb" : "Tamb-or-other").toBe(reference);
        }
      }
    }
  });

  test("the question text states the conditions it filtered on", () => {
    for (const q of superlatives) {
      for (const term of String(q.filter.conditions).split(";")) {
        expect(q.question).toContain(term.trim());
      }
    }
  });
});

describe("the truth is the corpus the system actually has", () => {
  test("no winner is a held-out part", () => {
    for (const q of questions) {
      for (const part of q.truthParts) expect(isHoldout(part)).toBe(false);
    }
  });

  test("a held-out part is never counted, even when it would win", () => {
    // Falsifier for the whole claim: if the generator scanned all 680 labels, at
    // least one group's extremum would land on a holdout, because 27% of the
    // corpus is held out and the extremes are not politely distributed.
    // `candidatesOf(q)` is hoisted out of the predicate on purpose. Called inside it,
    // it rescanned all 680 labels once per label per question — 25 million operations,
    // six seconds, and a test that failed by TIMING OUT whenever the machine was busy.
    // A flaky test is a broken test, and this one was broken by being written inside
    // out, not by the work being heavy.
    const wouldWin = superlatives.filter((q) => {
      const candidates = new Set(candidatesOf(q).map((c) => c.part));
      return labels.some((l) => candidates.has(l.part) && isHoldout(l.part));
    });
    expect(wouldWin).toHaveLength(0);
  });
});

describe("a tie is a fact about the corpus, not a defect in it", () => {
  test("every part tied at the extremum is accepted", () => {
    for (const q of superlatives) {
      const candidates = candidatesOf(q);
      const tied = candidates.filter((c) => valueIn(c, q) === q.truthValue).map((c) => c.part);
      expect([...q.truthParts].sort()).toEqual([...tied].sort());
    }
  });

  test("ties exist, so the rule above is load-bearing rather than decorative", () => {
    expect(superlatives.filter((q) => q.truthParts.length > 1).length).toBeGreaterThan(0);
  });
});

describe("the questions name a constraint, never a part", () => {
  test("no question text contains a part number from the corpus", () => {
    for (const q of questions) {
      for (const token of namedParts(q.question)) {
        expect(byPart.has(token)).toBe(false);
      }
    }
  });

  test("a voltage-class count carries no token the part regex can grab at all", () => {
    // Package names (LFPAK33, SOT669, Power-SO8) DO match the part-number regex,
    // which is the guard's false-positive class and a finding of its own. The
    // voltage-class counts are the clean control group: they isolate set
    // reasoning from that bug.
    for (const q of questions.filter((x) => x.id.startsWith("corpus:count-vds:"))) {
      expect(namedParts(q.question)).toHaveLength(0);
    }
  });
});
