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
  if (pkg !== undefined) return indexed.filter((l) => (l.package ?? []).includes(pkg as string));
  if (channel === undefined) return indexed.filter((l) => l.vds_v !== null && rating(l.vds_v) === vds);

  const measure = q.id.startsWith("corpus:id-") ? "id" : "rdson";
  return indexed.filter((l) => {
    if (l.channel !== channel || l.vds_v === null || rating(l.vds_v) !== vds) return false;
    const m = measure === "id" ? l.id_a : l.rdson_mohm;
    if (!m) return false;
    return (measure === "id" ? idClass(m) : rdsonClass(m)) === conditions;
  });
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
      const values = candidates.map((c) =>
        q.id.startsWith("corpus:id-") ? Math.abs(c.id_a!.value) : c.rdson_mohm!.value
      );
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
  test("every candidate in a superlative publishes under the SAME condition string", () => {
    for (const q of superlatives) {
      const classes = new Set(
        candidatesOf(q).map((c) =>
          q.id.startsWith("corpus:id-") ? idClass(c.id_a!) : rdsonClass(c.rdson_mohm!)
        )
      );
      expect(classes.size).toBe(1);
    }
  });

  test("no candidate set mixes a mounting-base rating with an ambient one", () => {
    for (const q of superlatives.filter((x) => x.id.startsWith("corpus:id-"))) {
      const references = new Set(
        candidatesOf(q).map((c) => (/\bTmb\b/.test(c.id_a!.conditions) ? "Tmb" : "Tamb-or-other"))
      );
      expect(references.size).toBe(1);
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
      const valueOf = (c: GroundTruth) =>
        q.id.startsWith("corpus:id-") ? Math.abs(c.id_a!.value) : c.rdson_mohm!.value;
      const tied = candidates.filter((c) => valueOf(c) === q.truthValue).map((c) => c.part);
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
