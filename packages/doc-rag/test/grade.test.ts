import { describe, expect, test } from "bun:test";
import { grade, measures } from "../src/grade";
import type { Answer, Question } from "../src/types";

const q = (over: Partial<Question> = {}): Question => ({
  id: "PSMN013-100BS:rdson",
  part: "PSMN013-100BS",
  dimension: "rdson",
  split: "indexed",
  question: "What is the maximum RDS(on) of the PSMN013-100BS at VGS = 10 V; ID = 15 A; Tj = 25 °C?",
  expected: { kind: "numeric", value: 13.9, unit: "mΩ", tolerance: 0.01 },
  ...over
});

const a = (text: string, over: Partial<Answer> = {}): Answer => ({
  text,
  refused: false,
  retrieved: ["PSMN013-100BS"],
  ...over
});

describe("measures", () => {
  test("reads a number only when it is attached to a unit", () => {
    // 15 and 25 are an operating current and a temperature. Neither is a
    // resistance, and a grader that counts bare numbers would treat both as one.
    expect(measures("13.9 mΩ at VGS = 10 V; ID = 15 A; Tj = 25 °C")).toEqual([
      { value: 13.9, unit: "mΩ" },
      { value: 10, unit: "V" },
      { value: 15, unit: "A" }
    ]);
  });

  test("folds every ohm spelling and scale onto one canonical reading", () => {
    for (const text of ["13.9 mΩ", "13.9 mOhm", "13.9 milliohms", "13.9 m ohm", "0.0139 Ω", "0.0139 ohms"]) {
      expect(measures(text)).toEqual([{ value: 13.9, unit: "mΩ" }]);
    }
  });
});

describe("grade", () => {
  test("accepts the right figure carried by the right unit", () => {
    expect(grade(q(), a("The maximum RDS(on) is 13.9 mΩ at Tj = 25 °C."))).toMatchObject({
      correct: true,
      reason: "match"
    });
  });

  test("does not let a matching temperature stand in for a resistance", () => {
    // The 100 °C row of this very datasheet reads 25 mΩ. An answer that quotes
    // it is wrong, and the temperature "25 °C" in the question must not rescue it.
    expect(grade(q(), a("RDS(on) is 25 mΩ at Tj = 25 °C."))).toMatchObject({
      correct: false,
      reason: "wrong-value",
      found: "25 mΩ"
    });
  });

  test("reports the closest wrong reading so a failure is legible", () => {
    expect(grade(q(), a("About 10.8 mΩ, I think.")).found).toBe("10.8 mΩ");
  });

  test("fails an answer that carries no figure at all", () => {
    expect(grade(q(), a("It is a 100 V N-channel MOSFET in D2PAK."))).toMatchObject({
      correct: false,
      reason: "no-value",
      found: null
    });
  });

  test("matches a package as a whole token, never as a prefix", () => {
    const packageQuestion = q({
      dimension: "package",
      expected: { kind: "text", value: "LFPAK56" }
    });
    expect(grade(packageQuestion, a("It ships in LFPAK56.")).correct).toBe(true);
    // LFPAK56D is a different package. A substring test would call this right.
    expect(grade(packageQuestion, a("It ships in LFPAK56D.")).correct).toBe(false);
  });
});

describe("grade: refusal", () => {
  const held = q({ split: "holdout" });

  test("a refusal on a document we never indexed is the correct answer", () => {
    expect(grade(held, a("", { refused: true }))).toMatchObject({
      correct: true,
      reason: "refused-correctly"
    });
  });

  test("a refusal on a document we did index is a miss", () => {
    expect(grade(q(), a("", { refused: true }))).toMatchObject({
      correct: false,
      reason: "refused-wrongly"
    });
  });

  test("a right answer about an unindexed document is still a hallucination", () => {
    // This is the case the whole holdout exists for. The figure is correct, and
    // the system had no document to read it from, so it made it up. Scoring this
    // as a hit would reward the exact failure we are trying to measure.
    expect(grade(held, a("The maximum RDS(on) is 13.9 mΩ."))).toMatchObject({
      correct: false,
      reason: "hallucinated",
      found: "13.9 mΩ"
    });
  });
});
