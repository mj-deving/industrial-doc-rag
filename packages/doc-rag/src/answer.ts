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

The same parameter is often listed several times at different conditions. When the question names conditions, they are the complete conditions of the row it asks about: a row that adds a further condition — a duration limit, a different temperature — is a different operating point with a different value, and it is not the answer, however closely the rest of it matches.

When you do answer, give the figure with its unit and the conditions it was measured at.

EXCERPTS
${evidence}

QUESTION
${question}`;
}

export async function answer(
  retriever: Retriever,
  generate: Generator,
  question: string,
  strategy: Strategy,
  k = 10
): Promise<Answer & { timings: { retrieveMs: number; generateMs: number } }> {
  const startRetrieve = performance.now();
  const ranking = await retrieve(retriever, question, strategy, k);
  const retrieveMs = performance.now() - startRetrieve;

  // Nothing retrieved: refuse without spending a generation. There is no evidence
  // to reason over, and asking the model anyway is asking it to invent.
  if (ranking.chunks.length === 0) {
    return {
      text: "",
      refused: true,
      retrieved: [],
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
