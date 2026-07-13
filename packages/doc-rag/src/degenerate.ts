/**
 * Catch a generator that has stopped generating.
 *
 * Four of the first 150 answers came back as literal token soup:
 *
 *   "uling seeded seeded seeded seeded seeded Hlav Hlav Hlavulingulinguling..."
 *
 * This is not a wrong answer and it is not a refusal. It is the decoder falling
 * apart, and on this platform it happens at about 2.7% of calls to an fp8-quantised
 * model. It matters more than its rate suggests, because the failure is silent:
 * the response is HTTP 200, the answer field is a string, and every downstream
 * consumer treats it as an answer. A grader scores it "no value found" and files
 * it beside honest misses, so the one failure a customer would call broken is the
 * one the benchmark hides best.
 *
 * The test is repetition, not vocabulary. A real answer about a MOSFET repeats
 * units and part numbers, so a blacklist of the words this model happens to emit
 * ("seeded", "uling") would catch this one incident and nothing else. What
 * generalises is that a collapsed decode says one thing over and over.
 */

/** Twelve words is longer than any answer the prompt asks for, so a shorter text
 *  has no room to establish repetition and is judged on its content elsewhere. */
const MIN_WORDS = 12;

/** Above this share of the text, one repeated word is not emphasis. A real answer
 *  quoting "25 A at VGS = 10 V; ID = 25 A" tops out well below it. */
const MAX_SHARE = 0.3;

export function isDegenerate(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < MIN_WORDS) return false;

  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);

  const top = Math.max(...counts.values());
  return top / words.length > MAX_SHARE;
}
