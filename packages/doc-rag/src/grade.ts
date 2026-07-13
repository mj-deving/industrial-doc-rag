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
 */

import type { Answer, Expected, Question } from "./types";

export type Grade = {
  correct: boolean;
  /** Why. Kept on every result so a failing case can be read without a rerun. */
  reason: "match" | "refused-correctly" | "wrong-value" | "no-value" | "hallucinated" | "refused-wrongly";
  /** What we found in the answer, in canonical form. Null when nothing parsed. */
  found: string | null;
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

function near(actual: number, expected: number, tolerance: number): boolean {
  // An absolute floor keeps a tolerance of 1% from becoming meaningless as the
  // expected value approaches zero (a 0.5 mOhm part exists in this corpus).
  return Math.abs(actual - expected) <= Math.max(Math.abs(expected) * tolerance, 1e-9);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A package name must match as a whole token. `LFPAK56` is a prefix of
 * `LFPAK56D` and they are different packages, so a substring test would mark a
 * wrong answer right.
 */
function mentions(text: string, value: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escape(value)}(?![A-Za-z0-9])`, "i").test(text);
}

function matchesValue(text: string, expected: Expected): { ok: boolean; found: string | null } {
  if (expected.kind === "text") {
    return { ok: mentions(text, expected.value), found: mentions(text, expected.value) ? expected.value : null };
  }

  const parsed = measures(text).filter((m) => m.unit === expected.unit);
  if (parsed.length === 0) return { ok: false, found: null };

  const hit = parsed.find((m) => near(m.value, expected.value, expected.tolerance));
  if (hit) return { ok: true, found: `${hit.value} ${hit.unit}` };

  // Report the closest wrong reading. This is what makes a failure legible:
  // "said 25 mOhm, wanted 13.9 mOhm" names the bug; "wrong" does not.
  const closest = parsed.reduce((a, b) =>
    Math.abs(a.value - expected.value) <= Math.abs(b.value - expected.value) ? a : b
  );
  return { ok: false, found: `${closest.value} ${closest.unit}` };
}

export function grade(question: Question, answer: Answer): Grade {
  const held = question.split === "holdout";

  if (answer.refused) {
    return held
      ? { correct: true, reason: "refused-correctly", found: null }
      : { correct: false, reason: "refused-wrongly", found: null };
  }

  const { ok, found } = matchesValue(answer.text, question.expected);

  // A holdout part is not in the index. Any substantive answer about it was
  // invented, and an invented answer that happens to be right is still invented:
  // it is graded as a hallucination, not as a hit.
  if (held) return { correct: false, reason: "hallucinated", found };

  if (ok) return { correct: true, reason: "match", found };
  return { correct: false, reason: found === null ? "no-value" : "wrong-value", found };
}
