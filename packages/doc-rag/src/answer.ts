/**
 * Generation, and the refusal contract.
 *
 * The hard case is not "the index is empty". It is that a held-out datasheet is
 * missing while 496 nearly identical ones are present, so retrieval happily
 * returns ten well-formed tables for the WRONG parts. Every number in them looks
 * exactly like the number the question wants. A model that answers from "the most
 * relevant excerpt" will produce a confident, well-formatted, completely invented
 * figure, and no amount of retrieval tuning prevents it.
 *
 * So two things are structural rather than hoped for:
 *
 *   1. Every excerpt is labelled with the part number of the datasheet it came
 *      from. Without the label the model cannot even tell that the excerpts are
 *      about a different component; it would be judging a question it cannot see
 *      the evidence for.
 *
 *   2. Refusal is a token, not a phrasing. The model emits NOT_IN_CORPUS, and the
 *      caller reads a boolean. Grading refusal by grepping prose for "I don't
 *      have" measures the model's manners and breaks the moment it is polite in a
 *      new way.
 */

import { withoutNames } from "./text";
import { MAX_CHARS } from "./chunk";
import { retrieve, type Retriever, type Strategy } from "./retrieve";
import type { Answer } from "./types";

export type Generator = (prompt: string) => Promise<string>;

export const REFUSAL_TOKEN = "NOT_IN_CORPUS";

/**
 * How much of a retrieved chunk the model is shown. It is the chunker's own
 * ceiling, so the answer is: all of it.
 *
 * This was 900, with a comment saying excerpts are truncated "so a 10-chunk
 * context stays inside a small model's window" — a number I guessed, against a
 * window I never measured, sitting downstream of a chunker that bounds a chunk at
 * 1800. The two constants had to agree and nothing made them, so the model was
 * shown the first HALF of every chunk it retrieved and the second half was thrown
 * away silently.
 *
 * What that cost: PMPB14XP's Limiting Values table retrieved correctly, at rank 1,
 * with the asked-for row present. The row sat at character 1040 of a 1057-character
 * chunk. The model never saw it. It saw the ID row above it — the one with the
 * `t <= 5 s` duration limit — answered from that, and was marked wrong for reading
 * the only ID row I had left in its context. Every table chunk loses its LAST rows
 * this way, and the last rows of a limiting-values table are exactly the operating
 * points a question distinguishes between.
 *
 * Tying it to the chunker's constant is the point. A prompt that re-bounds a chunk
 * with a second, unrelated number is a prompt that will disagree with the chunker
 * the moment either one moves.
 */
export const EXCERPT_CHARS = MAX_CHARS;

/** What the model is actually shown for one chunk. Exported so a diagnostic can
 *  inspect the same bytes the model read, rather than the ones it might have. */
export function visible(text: string): string {
  return text.slice(0, EXCERPT_CHARS);
}

export function buildPrompt(question: string, excerpts: { part: string; text: string }[]): string {
  const evidence = excerpts.map((e) => `[${e.part}]\n${visible(e.text)}`).join("\n\n---\n\n");

  return `Answer the question using ONLY the datasheet excerpts below.

Each excerpt is labelled with the part number of the datasheet it came from.

If none of the excerpts come from the exact part the question asks about, reply with exactly ${REFUSAL_TOKEN} and nothing else. A part whose identifier differs by even one character is a different part, not a substitute, however similar the rest of the document looks.

The excerpts are tables rendered as plain text. A parameter's value is in the Min, Typ or Max column of that parameter's own row. The same symbol also appears inside OTHER rows, in their Conditions column, where it names the test condition that other parameter was measured under. A symbol inside a Conditions column is never that symbol's own rating, and the number written next to it there is not the answer to a question about it.

The same parameter is listed several times, once per operating point. Pick the row whose conditions are EXACTLY the ones the question names, and no others. A row that lists every condition the question names AND ONE MORE is a different operating point: it is the wrong row precisely because it matches everything you were asked for and then adds a qualifier you were not asked for. A duration limit such as "t <= 5 s" is such a qualifier, and so is a different temperature.

For example, asked for ID at "VGS = 4.5 V; Tamb = 25 °C", given these rows:

    ID   drain current   VGS = 4.5 V; Tamb = 25 °C; t <= 5 s   -   13    A
    ID   drain current   VGS = 4.5 V; Tamb = 25 °C             -   8.9   A

the answer is 8.9 A. The 13 A row satisfies both conditions in the question, and it is still the wrong row, because it holds only for 5 seconds and the question did not ask for a 5-second rating.

When you do answer, give the figure with its unit and the conditions it was measured at.

EXCERPTS
${evidence}

QUESTION
${question}`;
}

/**
 * The part identifiers named in a question.
 *
 * Two or more letters, then alphanumerics and hyphens, carrying at least one
 * digit: `PSMN1R0-30YLD`, `BUK9M43-100E`, `PMV45EN2`. Checked against all 2629
 * questions in the benchmark — it extracts the asked part every time and never
 * extracts anything else, because nothing else in a question about a MOSFET has
 * this shape (`VGS`, `ID` and `Tamb` carry no digit; `10 V` and `25 °C` start
 * with one).
 */
const PART_ID = /\b[A-Z]{2,5}[A-Z0-9]*\d[A-Z0-9]*(?:-[A-Z0-9]+)*\b/g;

export function namedParts(question: string): string[] {
  return [...new Set(question.match(PART_ID) ?? [])];
}

/**
 * Would the identifier guard refuse this question, given what was retrieved?
 *
 * The refusal contract is a rule about identifiers, and the prompt asks the model
 * to enforce it: "if none of the excerpts come from the exact part the question
 * asks about, reply NOT_IN_CORPUS." That is a request. This is the same rule as a
 * guarantee, and it is exported so the eval can measure both — what the model does
 * on its own, and what the shipped system does.
 *
 * The model is not bad at the rule; it is asked to apply it while holding ten
 * excerpts from parts whose datasheets are word-for-word identical to the one it
 * wants. It fails in two ways, and both are visible in the holdout results:
 * it answers from a sibling part's table, and — worse — it DECODES THE PART NUMBER.
 * `PSMN1R0-30YLD` is a 30 V part with an RDS(on) near 1.0 mΩ, and the name says so.
 * Asked about a datasheet it has never seen, the model reads the naming convention
 * and answers 30 V, confidently, and is often RIGHT. A right answer about a document
 * that is not in the corpus is the most dangerous output this system can produce:
 * it is indistinguishable from a grounded one, and nothing in the corpus supports it.
 *
 * A deterministic check cannot be talked out of the rule by a convincing sibling.
 */
/**
 * `ignore` is the corpus saying "these identifier-shaped tokens are not documents".
 *
 * The guard's adversary is a part number that is not in the index, and a package
 * name looks exactly like one: `LFPAK33`, `SOT669` and `SO8` all match the
 * identifier pattern, none of them is a part, and none of them can ever be
 * retrieved. So the guard refused "how many parts come in an LFPAK33 package?" —
 * 25 of 40 count questions, refused for a reason that has nothing to do with the
 * question. That is the false-positive class that gets guards switched off, and it
 * is worse than a miss, because a guard nobody trusts guards nothing.
 *
 * The names are STRIPPED FROM THE TEXT, not subtracted from the tokens the regex
 * returns, and the difference is three more refusals that survived the first fix.
 * `Power-SO8` goes into the identifier regex and `SO8` comes out — the regex does not
 * tokenise a package name the way the vocabulary spells it. The vocabulary holds
 * `Power-SO8`; the token was `SO8`; the set-membership test compared two spellings of
 * one name and refused a question about a package the catalogue holds 139 parts of.
 * A name that has been removed from the text cannot be tokenised into a disagreement.
 *
 * The list is derived from the corpus (the catalogue's own package vocabulary), not
 * hand-written, so it cannot go stale as the corpus grows.
 */
export function guardRefuses(
  question: string,
  retrievedParts: string[],
  ignore: ReadonlySet<string> = new Set()
): boolean {
  const named = namedParts(withoutNames(question, ignore));
  if (named.length === 0) return false; // No identifier to check: the model decides.
  const have = new Set(retrievedParts);
  return !named.some((part) => have.has(part));
}

export async function answer(
  retriever: Retriever,
  generate: Generator,
  question: string,
  strategy: Strategy,
  k = 10,
  /** Off only in the eval, which measures what the MODEL does without the guarantee. */
  guard = true,
  /** Identifier-shaped tokens the corpus says are not documents (package names).
   *  See `guardRefuses`. */
  ignore: ReadonlySet<string> = new Set()
): Promise<Answer & { timings: { retrieveMs: number; generateMs: number } }> {
  const startRetrieve = performance.now();
  const ranking = await retrieve(retriever, question, strategy, k);
  const retrieveMs = performance.now() - startRetrieve;

  // Nothing retrieved: refuse without spending a generation. There is no evidence
  // to reason over, and asking the model anyway is asking it to invent.
  //
  // Same for a question that names a part no retrieved chunk came from. Retrieval
  // finds the asked document at rank 1 in every one of the 1918 indexed questions
  // (hybrid-rrf, recall@1 = 1.0), so a part missing from the results is a part
  // missing from the corpus, and there is nothing to answer from but a lookalike.
  if (ranking.chunks.length === 0 || (guard && guardRefuses(question, ranking.documents, ignore))) {
    return {
      text: REFUSAL_TOKEN,
      refused: true,
      retrieved: ranking.documents,
      evidence: [],
      timings: { retrieveMs, generateMs: 0 }
    };
  }

  const prompt = buildPrompt(
    question,
    ranking.chunks.map((c) => ({ part: c.chunk.documentId, text: c.chunk.text }))
  );

  const startGenerate = performance.now();
  const text = (await generate(prompt)).trim();
  const generateMs = performance.now() - startGenerate;

  return {
    text,
    refused: text.includes(REFUSAL_TOKEN),
    retrieved: ranking.documents,
    // The excerpts the answer was actually written from. Without these, a wrong
    // answer is indistinguishable from a right answer to a question the model was
    // never shown the evidence for, and the only way to tell them apart is to
    // guess. Two of the three defects found in this system so far were found by
    // dumping what was really there instead of reasoning about what should be.
    evidence: ranking.chunks.map((c) => ({ part: c.chunk.documentId, text: c.chunk.text })),
    timings: { retrieveMs, generateMs }
  };
}
