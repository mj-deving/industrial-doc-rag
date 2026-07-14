import { describe, expect, test } from "bun:test";
import { grade, measures } from "../src/grade";
import type { Answer, Expected, Question } from "../src/types";

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
  evidence: [],
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

  /**
   * The P-channel case, which the first eval got wrong in the label rather than
   * in the system. BUK6Y19-30P prints -30 V in its quick-reference table. The
   * system read it, answered "-30 V", and the grader called that a miss because
   * the label stored the magnitude. Three questions were scored against a label
   * that disagreed with the document it came from.
   */
  const pChannel = q({
    id: "BUK6Y19-30P:vds",
    part: "BUK6Y19-30P",
    dimension: "vds",
    question: "What is the drain-source voltage rating (VDS) of the BUK6Y19-30P?",
    expected: { kind: "numeric", value: -30, unit: "V", tolerance: 0.01 }
  });

  test("reading a P-channel rating as the datasheet prints it is correct", () => {
    expect(grade(pChannel, a("-30 V, measured at Tj = 25 °C."))).toMatchObject({
      correct: true,
      reason: "match",
      signMatched: true
    });
  });

  test("quoting the same rating unsigned is correct, and the polarity is recorded", () => {
    // Engineers say "a 30 V P-channel part" out loud. Both readings identify the
    // same rating, so magnitude decides the grade. The dropped sign is not lost,
    // it lands in signMatched, where a system that emits polarity at random shows
    // up instead of hiding inside the accuracy figure.
    expect(grade(pChannel, a("30 V."))).toMatchObject({
      correct: true,
      reason: "match",
      signMatched: false
    });
  });

  test("the sign is not a licence to be wrong about the magnitude", () => {
    expect(grade(pChannel, a("-20 V."))).toMatchObject({ correct: false, reason: "wrong-value" });
  });
});

/**
 * A package has more than one true name, and one of them is spelled with a
 * character nobody can type. Both facts come from the datasheet, not from a wish
 * to be lenient.
 */
describe("package names", () => {
  test("any name the ordering table prints is a correct answer", () => {
    // BUK6Y19-30P's ordering row, verbatim: Name `LFPAK56; Power-SO8`, Version `SOT669`.
    const expected: Expected = { kind: "text", value: "LFPAK56", accepts: ["Power-SO8", "SOT669"] };
    const ask = (text: string) =>
      grade(
        { id: "q", part: "BUK6Y19-30P", dimension: "package", split: "indexed", question: "", expected },
        { text, refused: false, retrieved: [], evidence: [] }
      ).correct;

    expect(ask("It is supplied in an LFPAK56 package.")).toBe(true);
    expect(ask("Power-SO8.")).toBe(true);
    expect(ask("SOT669")).toBe(true);
    expect(ask("LFPAK33")).toBe(false);
  });

  test("a package is not its own longer-named neighbour", () => {
    const expected = { kind: "text", value: "LFPAK56" } as const;
    const graded = grade(
      { id: "q", part: "X", dimension: "package", split: "indexed", question: "", expected },
      { text: "LFPAK56D", refused: false, retrieved: [], evidence: [] }
    );
    expect(graded.correct).toBe(false);
  });

  test("the non-breaking hyphen Nexperia prints is the hyphen a person types", () => {
    // The label carries U+2011 because the PDF does. The model types U+002D, which
    // is the only hyphen on a keyboard. Same package, and it must not be a miss.
    const expected = { kind: "text", value: "DFN2020MD‑6" } as const;
    const graded = grade(
      { id: "q", part: "PMPB10EN", dimension: "package", split: "indexed", question: "", expected },
      { text: "DFN2020MD-6 (SOT1220).", refused: false, retrieved: [], evidence: [] }
    );
    expect(graded.correct).toBe(true);
  });
});
