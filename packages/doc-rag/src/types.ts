/**
 * The engine's contract with a corpus.
 *
 * Everything in `packages/doc-rag` is domain-agnostic: it knows about documents,
 * chunks, questions and answers, and nothing about MOSFETs. A corpus plugs in by
 * producing `Document`s and `Question`s. The datasheet adapter that does that for
 * Nexperia lives in `tools/`.
 *
 * The split between the two is not decoration. It is what makes the eval numbers
 * mean anything: if the engine knew what a datasheet was, it could cheat.
 */

export type Document = {
  /** Stable id. Also the retrieval label a question points at. */
  id: string;
  title: string;
  text: string;
  /** Anything the corpus wants to carry through to a citation. */
  meta?: Record<string, string | number | null>;
};

export type Chunk = {
  id: string;
  /** The `Document.id` this chunk came from. Retrieval is scored on this. */
  documentId: string;
  text: string;
  index: number;
};

export type Retrieved = {
  chunk: Chunk;
  score: number;
};

export type Expected =
  | { kind: "numeric"; value: number; unit: string; tolerance: number }
  /**
   * `value` is the name the question is graded on; `accepts` are the OTHER names
   * the datasheet gives for the same thing, and an answer using any of them is
   * right.
   *
   * This is not leniency, it is the document. BUK6Y19-30P's ordering table prints
   * its package as `LFPAK56; Power-SO8` and its version as `SOT669`: three names,
   * one package, all three printed by Nexperia on the same row. A single-string
   * label cannot hold that, so it silently picks one and marks the other two wrong.
   */
  | { kind: "text"; value: string; accepts?: string[] };

export type Question = {
  id: string;
  /** The document that contains the answer. The retrieval label. */
  part: string;
  dimension: string;
  /** "holdout": the document is NOT indexed, so the only correct answer is a refusal. */
  split: "indexed" | "holdout";
  question: string;
  expected: Expected;
};

/**
 * What the system under test returns.
 *
 * `refused` is a structured flag, not a phrase we grep for in prose. Grading a
 * refusal by string-matching the answer text ("I don't have", "not found", ...)
 * measures the model's phrasing, not its behaviour, and it breaks the moment the
 * model says the same thing in different words.
 */
export type Answer = {
  text: string;
  refused: boolean;
  /** Ranked document ids behind the answer, best first. */
  retrieved: string[];
  /** The excerpts the answer was written from, in the order the prompt saw them.
   *  A failure is only diagnosable against the evidence that produced it. */
  evidence: { part: string; text: string }[];
};
