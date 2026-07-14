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

import { retrieve, type Retriever, type Strategy } from "./retrieve";
import type { Answer } from "./types";

export type Generator = (prompt: string) => Promise<string>;

export const REFUSAL_TOKEN = "NOT_IN_CORPUS";

/** Excerpts are truncated so a 10-chunk context stays inside a small model's window. */
const EXCERPT_CHARS = 900;

export function buildPrompt(question: string, excerpts: { part: string; text: string }[]): string {
  const evidence = excerpts
    .map((e) => `[${e.part}]\n${e.text.slice(0, EXCERPT_CHARS)}`)
    .join("\n\n---\n\n");

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
