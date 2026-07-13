/**
 * Pull part numbers out of a question.
 *
 * This is the corpus's contribution to retrieval and the only place the engine
 * learns what a document identifier looks like here. A different corpus swaps
 * this one function: case numbers, invoice numbers, ISBNs.
 *
 * The prefix list is Nexperia's MOSFET families. It is deliberately generous,
 * because a token that is not a real part simply finds nothing in the index and
 * costs one filtered query. A missed token, on the other hand, silently disables
 * the symbol arm for that question, which is the failure that would flatter the
 * dense baseline.
 */

const PREFIXES = ["PSMN", "BUK", "PMPB", "PMV", "PXN", "PMN", "PHP", "PHD", "PHT", "BSC"];
const PART = new RegExp(`\\b(?:${PREFIXES.join("|")})[A-Z0-9]+(?:-[A-Z0-9]+)*\\b`, "gi");

export function partNumbersIn(query: string): string[] {
  const found = new Set<string>();
  for (const match of query.matchAll(PART)) {
    const part = match[0].toUpperCase();
    if (part.length >= 6 && /\d/.test(part)) found.add(part);
  }
  return [...found];
}
