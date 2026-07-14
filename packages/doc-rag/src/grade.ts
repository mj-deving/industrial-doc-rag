/**
 * Grade an answer against a label.
 *
 * The whole benchmark rests on this file, so it is written to be strict in the
 * one way that matters and forgiving in the ways that do not.
 *
 * Strict: a number only counts if it is ATTACHED to the right unit. An answer
 * about a MOSFET is full of numbers ("13.6 mOhm at VGS = 10 V, Tj = 25 C") and a
 * grader that just asks "does 25 appear in the text" will mark a wrong answer
 * correct because the junction temperature happened to match the voltage rating.
 * That is not a hypothetical: it is the most likely way a RAG benchmark quietly
 * inflates its own score.
 *
 * Forgiving: 1 and 1.0 are the same number, "mOhm" and "mΩ" are the same unit,
 * and 0.0136 Ω is the same resistance as 13.6 mΩ. None of those are the system
 * being right or wrong, they are formatting.
 *
 * Forgiving about SIGN, and this one was a bug for a while. A P-channel MOSFET
 * quotes its ratings negative: the BUK6Y19-30P datasheet says -30 V. The label
 * used to store the magnitude, so a system that read the document correctly and
 * answered "-30 V" was marked wrong. It was not wrong; the benchmark was. Both
 * "30 V" and "-30 V" identify the same rating, and an engineer says both, so the
 * magnitude decides correctness. The sign is not thrown away: `signMatched`
 * records whether the answer reproduced the polarity the datasheet printed, and
 * the eval reports it. A system that emits signs at random shows up there rather
 * than hiding inside the accuracy figure.
 */

import type { Answer, Expected, Question } from "./types";

export type Grade = {
  correct: boolean;
  /** Why. Kept on every result so a failing case can be read without a rerun. */
  reason: "match" | "refused-correctly" | "wrong-value" | "no-value" | "hallucinated" | "refused-wrongly";
  /** What we found in the answer, in canonical form. Null when nothing parsed. */
  found: string | null;
  /** Did the answer reproduce the datasheet's polarity? Null when no number was
   *  parsed, or when the question is not numeric. Reported, never graded. */
  signMatched: boolean | null;
};

/** Every codepoint a model might use for "ohm": Greek capital, the dedicated OHM
 *  SIGN, and lowercase omega. They look identical and are three different
 *  characters, so a naive comparison drops a correct answer on the floor. */
const OHM_SIGNS = /[ΩΩω]/g;

/** number + unit, with the spellings a model actually produces. */
const MEASURE =
  /(-?\d+(?:[.,]\d+)?)\s*(m[ΩΩω]|milliohms?|m\s?ohms?|[ΩΩω]|ohms?|kV|mV|V|volts?|mA|A|amperes?|amps?)(?![a-z0-9])/gi;

type Measure = { value: number; unit: string };

/** A scale conversion in binary floating point leaves grit: 0.0139 * 1000 is
 *  13.899999999999999. The tolerance would absorb it, but the failure report
 *  would print it, so it dies here. Twelve significant digits cannot collide two
 *  figures this corpus actually distinguishes. */
const clean = (value: number): number => Number(value.toPrecision(12));

/** Fold every spelling and scale onto one canonical (value, unit) pair. */
function canonical(raw: string, unit: string): Measure | null {
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const u = unit.replace(OHM_SIGNS, "ohm").toLowerCase().replace(/\s+/g, "");

  if (/^(milliohms?|mohms?)$/.test(u)) return { value, unit: "mΩ" };
  if (/^ohms?$/.test(u)) return { value: clean(value * 1000), unit: "mΩ" };
  if (/^(v|volts?)$/.test(u)) return { value, unit: "V" };
  if (/^kv$/.test(u)) return { value: clean(value * 1000), unit: "V" };
  if (/^mv$/.test(u)) return { value: clean(value / 1000), unit: "V" };
  if (/^(a|amperes?|amps?)$/.test(u)) return { value, unit: "A" };
  if (/^ma$/.test(u)) return { value: clean(value / 1000), unit: "A" };
  return null;
}

export function measures(text: string): Measure[] {
  const found: Measure[] = [];
  for (const match of text.matchAll(MEASURE)) {
    const measure = canonical(match[1], match[2]);
    if (measure) found.push(measure);
  }
  return found;
}

/** Magnitudes, because the polarity of a P-channel rating is a fact about the
 *  device and not about whether the system read it. See the header. */
function near(actual: number, expected: number, tolerance: number): boolean {
  // An absolute floor keeps a tolerance of 1% from becoming meaningless as the
  // expected value approaches zero (a 0.5 mOhm part exists in this corpus).
  const size = Math.abs(expected);
  return Math.abs(Math.abs(actual) - size) <= Math.max(size * tolerance, 1e-9);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every dash a typesetter reaches for, folded onto the one a person types.
 *
 * Nexperia prints `DFN2020MD‑6` with a NON-BREAKING hyphen (U+2011) in some
 * datasheets and an ASCII `-` in others — the same package, two codepoints that
 * render identically. Without this, a model that reads the part correctly and
 * types the obvious hyphen is marked wrong for a character it cannot see. Exactly
 * the ohm-sign trap in the header, one row down.
 */
const DASHES = /[‐‑‒–—―−]/g;
const flatten = (text: string): string => text.replace(DASHES, "-");

/**
 * A package name must match as a whole token. `LFPAK56` is a prefix of
 * `LFPAK56D` and they are different packages, so a substring test would mark a
 * wrong answer right.
 */
function mentions(text: string, value: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escape(flatten(value))}(?![A-Za-z0-9])`, "i").test(
    flatten(text)
  );
}

type Match = { ok: boolean; found: string | null; signMatched: boolean | null };

function matchesValue(text: string, expected: Expected): Match {
  if (expected.kind === "text") {
    // The graded name, then the other names the datasheet prints for the same
    // thing. `LFPAK56`, `Power-SO8` and `SOT669` are one package on one row of one
    // table, and an engineer answers with whichever is in front of them.
    const named = [expected.value, ...(expected.accepts ?? [])];
    const hit = named.find((name) => mentions(text, name));
    return { ok: hit !== undefined, found: hit ?? null, signMatched: null };
  }

  const parsed = measures(text).filter((m) => m.unit === expected.unit);
  if (parsed.length === 0) return { ok: false, found: null, signMatched: null };

  // Zero has no polarity to reproduce, and neither does a rating the label
  // itself stores unsigned, so `signMatched` is only meaningful once both sides
  // carry one.
  const polarity = (value: number) => Math.sign(value);
  const sign = (m: Measure) =>
    expected.value === 0 ? null : polarity(m.value) === polarity(expected.value);

  const hit = parsed.find((m) => near(m.value, expected.value, expected.tolerance));
  if (hit) return { ok: true, found: `${hit.value} ${hit.unit}`, signMatched: sign(hit) };

  // Report the closest wrong reading. This is what makes a failure legible:
  // "said 25 mOhm, wanted 13.9 mOhm" names the bug; "wrong" does not.
  const closest = parsed.reduce((a, b) =>
    Math.abs(Math.abs(a.value) - Math.abs(expected.value)) <=
    Math.abs(Math.abs(b.value) - Math.abs(expected.value))
      ? a
      : b
  );
  return { ok: false, found: `${closest.value} ${closest.unit}`, signMatched: sign(closest) };
}

/**
 * Does this text contain the expected value at all?
 *
 * The same reader the grader uses, pointed at a retrieved excerpt instead of an
 * answer. It is what `tools/evidence.ts` asks of the ten chunks a model was
 * handed: was the answer in there, or was the model asked to invent?
 *
 * Weaker for a number than for a package name, and the difference matters. A
 * datasheet row is full of numbers, so `13 A` appearing SOMEWHERE in an excerpt
 * does not prove it appears as the answer to THIS question — it may be another
 * parameter's rating, or a test condition. A hit here means the answer is
 * reachable from the evidence, never that the evidence is unambiguous. A MISS,
 * though, is conclusive: the number is not in the text, so the model could only
 * have invented it.
 */
export function carriesValue(text: string, expected: Expected): boolean {
  return matchesValue(text, expected).ok;
}

export function grade(question: Question, answer: Answer): Grade {
  const held = question.split === "holdout";

  if (answer.refused) {
    return held
      ? { correct: true, reason: "refused-correctly", found: null, signMatched: null }
      : { correct: false, reason: "refused-wrongly", found: null, signMatched: null };
  }

  const { ok, found, signMatched } = matchesValue(answer.text, question.expected);

  // A holdout part is not in the index. Any substantive answer about it was
  // invented, and an invented answer that happens to be right is still invented:
  // it is graded as a hallucination, not as a hit.
  if (held) return { correct: false, reason: "hallucinated", found, signMatched };

  if (ok) return { correct: true, reason: "match", found, signMatched };
  return { correct: false, reason: found === null ? "no-value" : "wrong-value", found, signMatched };
}
